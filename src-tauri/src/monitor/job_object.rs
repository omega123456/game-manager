//! Mode A — job-object tree monitoring (default, zero-config).
//!
//! The game is launched directly by us and assigned to a Windows **job object**
//! wired to an I/O completion port. We then block on `GetQueuedCompletionStatus`
//! until the job reports `JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO` — i.e. every
//! process in the tree (the launched exe and any children it spawned, including
//! a bootstrapper that re-launches the real game) has exited. This precisely
//! times direct + bootstrapper games with no configuration.
//!
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` is set so that if the app process exits
//! mid-session the OS terminates the whole tree, leaving no orphaned children.
//!
//! The OS-facing primitive (launch a process into a job; wait for the tree to
//! empty) is abstracted behind [`JobLauncher`] so the session-writing + timing
//! logic is unit-testable with a fake on every platform. The real Windows
//! implementation ([`WindowsJobLauncher`]) is compiled only on Windows and is
//! the only Mode A code that touches raw FFI.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;

use super::stub::elapsed_seconds;
use super::{Monitor, StartOutcome};
use crate::db::repo::{games, sessions};
use crate::error::AppResult;
use crate::launch::cancel::CancelToken;
use crate::state::AppState;

/// How long the launched job tree must keep at least one live process before it
/// is treated as the running game. Some launch targets are thin bootstrappers
/// that exit within a split second (handing off to a detached launcher) — without
/// this grace period the session (and the After-Process scripts) would fire
/// against that transient process rather than the real game.
const DEFAULT_CONFIRM_DELAY: Duration = Duration::from_secs(3);

// ----- Self-defined JOB_OBJECT_MSG_* constants ------------------------------
//
// These completion-port message identifiers are documented by Microsoft but are
// NOT re-exported by the `windows` crate, so we define them locally using the
// stable documented values (winnt.h).

/// Posted when the active process count of a job drops to zero — the whole tree
/// has exited. This is the signal that ends a Mode A session.
pub const JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO: u32 = 4;
/// Posted when a new process is added to the job (diagnostic only).
pub const JOB_OBJECT_MSG_NEW_PROCESS: u32 = 6;
/// Posted when a process in the job exits (diagnostic only).
pub const JOB_OBJECT_MSG_EXIT_PROCESS: u32 = 7;

/// Abstraction over the OS job-object primitive used by Mode A.
///
/// An implementation launches `launch_target` (with optional `arguments`) into a
/// fresh job object and yields a handle on which [`JobHandle::wait_for_tree_exit`]
/// blocks until the tree empties. Implemented for real by [`WindowsJobLauncher`]
/// and by fakes in tests, so the loop/session logic runs without real processes.
#[async_trait]
pub trait JobLauncher: Send + Sync {
    /// The handle type returned on a successful launch.
    type Handle: JobHandle;

    /// Launch the target into a new job object, returning a wait handle.
    fn launch(&self, launch_target: &str, arguments: Option<&str>) -> AppResult<Self::Handle>;
}

/// A handle to a launched job-object tree.
#[async_trait]
pub trait JobHandle: Send + Sync {
    /// The pid of the process we launched into the job (the game for direct
    /// launches), used to raise its priority once it is running.
    fn pid(&self) -> u32;

    /// The number of live processes currently in the job tree.
    ///
    /// Used during the start grace period to confirm the launched tree survived
    /// (count > 0) rather than being a transient bootstrapper (count == 0).
    fn active_process_count(&self) -> AppResult<u32>;

    /// Block until the job reports `ACTIVE_PROCESS_ZERO`, or `cancel` fires.
    ///
    /// Returns `true` when the tree exited on its own; `false` when cancellation
    /// won the race (the `kill_on_job_close` job limit then terminates the tree
    /// when the handle drops).
    async fn wait_for_tree_exit(&self, cancel: &CancelToken) -> AppResult<bool>;
}

/// Split a stored arguments string into individual arguments (whitespace-split,
/// honoring double-quoted spans). Best-effort; good enough for typical launch
/// argument strings. Returns an empty vec for `None`/blank.
pub fn split_arguments(arguments: Option<&str>) -> Vec<String> {
    let Some(raw) = arguments else {
        return Vec::new();
    };
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for ch in raw.chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            c if c.is_whitespace() && !in_quotes => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        args.push(current);
    }
    args
}

/// Outcome of the post-launch confirmation grace period for the job tree.
enum ConfirmOutcome {
    /// The tree still had a live process after the grace period: the game is up.
    Confirmed,
    /// The tree emptied during the grace period (a transient bootstrapper).
    Vanished,
    /// Cancellation won the race during the grace period.
    Cancelled,
}

/// Mode A monitor: launches the game into a job object and times the tree.
pub struct JobObjectMonitor<L: JobLauncher> {
    launcher: L,
    confirm_delay: Duration,
    /// Live job handles parked between `wait_for_start` and `wait_for_end`,
    /// keyed by the session id token the trait carries.
    parked: std::sync::OnceLock<Mutex<HashMap<i64, Box<dyn std::any::Any + Send>>>>,
}

impl<L: JobLauncher> JobObjectMonitor<L> {
    /// Construct a Mode A monitor over the given job-launcher primitive.
    pub fn new(launcher: L) -> Self {
        JobObjectMonitor {
            launcher,
            confirm_delay: DEFAULT_CONFIRM_DELAY,
            parked: std::sync::OnceLock::new(),
        }
    }

    /// Override the post-launch confirmation grace period (defaults to
    /// [`DEFAULT_CONFIRM_DELAY`]). Tests use a tiny value to stay fast.
    pub fn with_confirm_delay(mut self, confirm_delay: Duration) -> Self {
        self.confirm_delay = confirm_delay;
        self
    }

    /// Wait out the confirmation grace period, then check the job tree still has
    /// a live process. Rejects launch targets that exit in a split second after
    /// handing off to a detached launcher.
    async fn confirm_running<H: JobHandle>(
        &self,
        handle: &H,
        cancel: &CancelToken,
    ) -> AppResult<ConfirmOutcome> {
        tokio::select! {
            _ = tokio::time::sleep(self.confirm_delay) => {}
            _ = cancel.cancelled() => return Ok(ConfirmOutcome::Cancelled),
        }
        if cancel.is_cancelled() {
            return Ok(ConfirmOutcome::Cancelled);
        }
        if handle.active_process_count()? > 0 {
            Ok(ConfirmOutcome::Confirmed)
        } else {
            Ok(ConfirmOutcome::Vanished)
        }
    }
}

/// Construct the default Windows-backed Mode A monitor.
#[cfg(windows)]
pub fn windows_monitor() -> JobObjectMonitor<WindowsJobLauncher> {
    JobObjectMonitor::new(WindowsJobLauncher)
}

/// State carried between `wait_for_start` and `wait_for_end` for Mode A. The
/// `Monitor` trait only passes an opaque `i64` token, so the live job handle is
/// parked in a per-monitor slot keyed by that token.
struct ActiveJob<H: JobHandle> {
    handle: H,
}

#[async_trait]
impl<L: JobLauncher> Monitor for JobObjectMonitor<L>
where
    L::Handle: 'static,
{
    async fn wait_for_start(
        &self,
        state: &AppState,
        game_id: i64,
        cancel: &CancelToken,
    ) -> AppResult<StartOutcome> {
        if cancel.is_cancelled() {
            return Ok(StartOutcome::Cancelled);
        }
        let game = state.with_db(|conn| games::get(conn, game_id))?;
        let handle = self
            .launcher
            .launch(&game.launch_target, game.arguments.as_deref())?;

        // The target was launched, but it may be a thin bootstrapper that exits
        // immediately. Only treat the launch as a real session once the job tree
        // has kept a live process through the confirmation grace period.
        match self.confirm_running(&handle, cancel).await? {
            ConfirmOutcome::Confirmed => {}
            ConfirmOutcome::Cancelled => return Ok(StartOutcome::Cancelled),
            ConfirmOutcome::Vanished => {
                tracing::warn!(
                    category = "monitor",
                    "job-object tree for '{}' emptied during confirmation; treating launch as \
                     transient (no session opened)",
                    game.launch_target
                );
                // `handle` drops here; kill_on_job_close cleans up any survivors.
                return Ok(StartOutcome::Cancelled);
            }
        }

        // Confirmed running: open the session and stash the handle so
        // wait_for_end can block on it. The session row is opened now (rather
        // than in wait_for_end) so the UI shows "playing" as soon as the game is
        // confirmed up, and the boxed handle is carried through a parked slot.
        let session_id = state.with_db(|conn| sessions::start(conn, game_id))?;
        // The launched process is confirmed running (for direct launches it is
        // the game itself): bump it to High priority when the setting is enabled.
        state.raise_priority_if_enabled(handle.pid());
        tracing::info!(
            category = "monitor",
            "job-object launched '{}'; session {session_id} started",
            game.launch_target
        );
        self.park_handle(session_id, ActiveJob { handle });
        Ok(StartOutcome::Started(session_id))
    }

    async fn wait_for_end(
        &self,
        state: &AppState,
        session_id: i64,
        cancel: &CancelToken,
    ) -> AppResult<i64> {
        if let Some(active) = self.take_handle(session_id) {
            if let Err(err) = active.handle.wait_for_tree_exit(cancel).await {
                tracing::warn!(
                    category = "monitor",
                    "job-object wait_for_tree_exit failed: {err}; closing session anyway"
                );
            }
            // `active` (and its handle) drops here: kill_on_job_close cleans up
            // any survivors if we exited the wait via cancellation.
        } else {
            tracing::warn!(
                category = "monitor",
                "no parked job handle for session {session_id}; closing session"
            );
        }
        state.with_db(|conn| {
            sessions::end(conn, session_id)?;
            let session = sessions::get(conn, session_id)?;
            Ok(elapsed_seconds(
                &session.started_at,
                session.ended_at.as_deref(),
            ))
        })
    }
}

/// Per-monitor parking slot for live job handles, keyed by session id.
///
/// `wait_for_start` parks the handle; `wait_for_end` takes it back. This keeps
/// the live `Send + Sync` handle alive across the two trait calls without
/// changing the trait's opaque-`i64` contract.
impl<L: JobLauncher> JobObjectMonitor<L>
where
    L::Handle: 'static,
{
    fn slots(&self) -> &Mutex<HashMap<i64, Box<dyn std::any::Any + Send>>> {
        // A lazily-initialized per-instance map. Stored via OnceLock so `new`
        // stays simple and the field is private.
        self.parked.get_or_init(|| Mutex::new(HashMap::new()))
    }

    fn park_handle(&self, session_id: i64, active: ActiveJob<L::Handle>) {
        if let Ok(mut map) = self.slots().lock() {
            map.insert(session_id, Box::new(active));
        }
    }

    fn take_handle(&self, session_id: i64) -> Option<ActiveJob<L::Handle>> {
        let boxed = self.slots().lock().ok()?.remove(&session_id)?;
        boxed.downcast::<ActiveJob<L::Handle>>().ok().map(|b| *b)
    }
}

// ----- Real Windows implementation (job object + completion port) -----------

/// The real Windows job launcher: `CreateProcessW` (suspended) → assign to a job
/// object with a completion port + `kill_on_job_close` → resume. The only Mode A
/// code that touches raw FFI.
#[cfg(windows)]
pub struct WindowsJobLauncher;

#[cfg(windows)]
impl JobLauncher for WindowsJobLauncher {
    type Handle = windows_impl::WindowsJobHandle;

    fn launch(&self, launch_target: &str, arguments: Option<&str>) -> AppResult<Self::Handle> {
        windows_impl::launch_into_job(launch_target, arguments)
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::{
        split_arguments, JobHandle, JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO,
        JOB_OBJECT_MSG_EXIT_PROCESS, JOB_OBJECT_MSG_NEW_PROCESS,
    };
    use crate::error::{AppError, AppResult};
    use crate::launch::cancel::CancelToken;

    use async_trait::async_trait;
    use std::os::windows::process::CommandExt;
    use std::process::{Child, Command};
    use std::sync::Arc;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectAssociateCompletionPortInformation,
        JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation,
        QueryInformationJobObject, SetInformationJobObject, JOBOBJECT_ASSOCIATE_COMPLETION_PORT,
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::OpenProcess;
    use windows::Win32::System::Threading::PROCESS_SET_QUOTA;
    use windows::Win32::System::Threading::PROCESS_TERMINATE;
    use windows::Win32::System::IO::{CreateIoCompletionPort, GetQueuedCompletionStatus};

    const CREATE_SUSPENDED: u32 = 0x0000_0004;

    /// A live Windows job-object tree handle.
    ///
    /// Owns the job handle + completion port. Dropping it closes the job; because
    /// `kill_on_job_close` is set, that terminates any survivors.
    pub struct WindowsJobHandle {
        job: HANDLE,
        port: HANDLE,
        // The pid of the launched process, surfaced so the monitor can raise its
        // priority once it is running.
        pid: u32,
        // Keep the launched child alive so its primary handle is not closed out
        // from under the job before the tree is timed.
        _child: Arc<Child>,
    }

    // SAFETY: the contained HANDLEs are owned solely by this struct and are only
    // used from the blocking wait task; the job/port handles are thread-safe to
    // wait on. Sending the handle to a worker thread for the blocking wait is
    // sound for these kernel object handles.
    unsafe impl Send for WindowsJobHandle {}
    unsafe impl Sync for WindowsJobHandle {}

    impl Drop for WindowsJobHandle {
        fn drop(&mut self) {
            // SAFETY: both handles are owned and non-null on a constructed value.
            unsafe {
                let _ = CloseHandle(self.job);
                let _ = CloseHandle(self.port);
            }
        }
    }

    /// Launch `launch_target` suspended, assign it to a job wired to a completion
    /// port with `kill_on_job_close`, then resume it.
    pub(super) fn launch_into_job(
        launch_target: &str,
        arguments: Option<&str>,
    ) -> AppResult<WindowsJobHandle> {
        // SAFETY: CreateJobObjectW with null name/attrs returns an owned handle.
        let job = unsafe { CreateJobObjectW(None, PCWSTR::null()) }
            .map_err(|err| AppError::other(format!("CreateJobObjectW failed: {err}")))?;

        // kill_on_job_close: orphaned children die if the app exits mid-session.
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: pointer + size describe a valid stack struct for this info class.
        unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        }
        .map_err(|err| AppError::other(format!("SetInformationJobObject(limits) failed: {err}")))?;

        // Associate a completion port so we are notified of ACTIVE_PROCESS_ZERO.
        // SAFETY: null existing port + 0 threads creates a new completion port.
        let port = unsafe {
            CreateIoCompletionPort(windows::Win32::Foundation::INVALID_HANDLE_VALUE, None, 0, 1)
        }
        .map_err(|err| AppError::other(format!("CreateIoCompletionPort failed: {err}")))?;
        let assoc = JOBOBJECT_ASSOCIATE_COMPLETION_PORT {
            CompletionKey: job.0 as *mut core::ffi::c_void,
            CompletionPort: port,
        };
        // SAFETY: pointer + size describe a valid stack struct for this info class.
        unsafe {
            SetInformationJobObject(
                job,
                JobObjectAssociateCompletionPortInformation,
                &assoc as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_ASSOCIATE_COMPLETION_PORT>() as u32,
            )
        }
        .map_err(|err| AppError::other(format!("SetInformationJobObject(port) failed: {err}")))?;

        // Spawn suspended so we can assign to the job before any child spawns.
        let mut command = Command::new(launch_target);
        for arg in split_arguments(arguments) {
            command.arg(arg);
        }
        command.creation_flags(CREATE_SUSPENDED);
        let child = command
            .spawn()
            .map_err(|err| AppError::Io(format!("spawn '{launch_target}' failed: {err}")))?;
        let pid = child.id();

        // Open the process with rights needed to assign + (implicitly) terminate.
        // SAFETY: pid refers to the just-spawned, still-suspended child.
        let proc_handle = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) }
            .map_err(|err| AppError::other(format!("OpenProcess({pid}) failed: {err}")))?;

        // SAFETY: job + process handles are valid and owned here.
        let assign = unsafe { AssignProcessToJobObject(job, proc_handle) };
        // The process handle from OpenProcess is no longer needed once assigned.
        // SAFETY: owned handle.
        unsafe {
            let _ = CloseHandle(proc_handle);
        }
        assign.map_err(|err| AppError::other(format!("AssignProcessToJobObject failed: {err}")))?;

        // Resume the child's primary thread now that it is inside the job.
        resume_primary_thread(pid)?;

        Ok(WindowsJobHandle {
            job,
            port,
            pid,
            _child: Arc::new(child),
        })
    }

    /// Resume the primary thread of `pid` (the process was created suspended).
    fn resume_primary_thread(pid: u32) -> AppResult<()> {
        use windows::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
        };
        use windows::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};

        // SAFETY: snapshot is closed below.
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) }
            .map_err(|err| AppError::other(format!("thread snapshot failed: {err}")))?;
        let mut entry = THREADENTRY32 {
            dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
            ..Default::default()
        };
        let mut resumed = false;
        // SAFETY: snapshot valid; entry.dwSize set.
        if unsafe { Thread32First(snapshot, &mut entry) }.is_ok() {
            loop {
                if entry.th32OwnerProcessID == pid {
                    // SAFETY: tid belongs to our suspended child.
                    if let Ok(thread) =
                        unsafe { OpenThread(THREAD_SUSPEND_RESUME, false, entry.th32ThreadID) }
                    {
                        // SAFETY: valid thread handle.
                        unsafe {
                            ResumeThread(thread);
                            let _ = CloseHandle(thread);
                        }
                        resumed = true;
                    }
                }
                // SAFETY: same snapshot/entry contract.
                if unsafe { Thread32Next(snapshot, &mut entry) }.is_err() {
                    break;
                }
            }
        }
        // SAFETY: owned snapshot handle.
        unsafe {
            let _ = CloseHandle(snapshot);
        }
        if resumed {
            Ok(())
        } else {
            Err(AppError::other(format!(
                "no primary thread found to resume for pid {pid}"
            )))
        }
    }

    /// Block on the completion port until ACTIVE_PROCESS_ZERO for this job.
    fn block_until_tree_exit(job: HANDLE, port: HANDLE) -> AppResult<bool> {
        loop {
            let mut bytes: u32 = 0;
            let mut key: usize = 0;
            let mut overlapped: *mut windows::Win32::System::IO::OVERLAPPED = std::ptr::null_mut();
            // SAFETY: out-params are valid locals; INFINITE timeout.
            let ok = unsafe {
                GetQueuedCompletionStatus(port, &mut bytes, &mut key, &mut overlapped, u32::MAX)
            };
            if ok.is_err() {
                return Err(AppError::other(
                    "GetQueuedCompletionStatus failed".to_string(),
                ));
            }
            // Only react to messages for our job (CompletionKey == job handle).
            if key == job.0 as usize {
                match bytes {
                    JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO => return Ok(true),
                    JOB_OBJECT_MSG_NEW_PROCESS | JOB_OBJECT_MSG_EXIT_PROCESS => {}
                    _ => {}
                }
            }
        }
    }

    #[async_trait]
    impl JobHandle for WindowsJobHandle {
        fn pid(&self) -> u32 {
            self.pid
        }

        fn active_process_count(&self) -> AppResult<u32> {
            let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            let mut returned: u32 = 0;
            // SAFETY: `self.job` is a valid owned job handle; the out-pointer and
            // size describe a valid stack struct for this info class.
            unsafe {
                QueryInformationJobObject(
                    self.job,
                    JobObjectBasicAccountingInformation,
                    &mut info as *mut _ as *mut core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                    Some(&mut returned),
                )
            }
            .map_err(|err| AppError::other(format!("QueryInformationJobObject failed: {err}")))?;
            Ok(info.ActiveProcesses)
        }

        async fn wait_for_tree_exit(&self, cancel: &CancelToken) -> AppResult<bool> {
            let job = self.job;
            let port = self.port;
            // The handles are valid for the lifetime of `self`, which outlives
            // this await (the caller holds the handle until this returns).
            let job_raw = job.0 as isize;
            let port_raw = port.0 as isize;
            let wait = tokio::task::spawn_blocking(move || {
                let job = HANDLE(job_raw as *mut core::ffi::c_void);
                let port = HANDLE(port_raw as *mut core::ffi::c_void);
                block_until_tree_exit(job, port)
            });
            tokio::select! {
                joined = wait => joined
                    .map_err(|err| AppError::other(format!("tree-wait task panicked: {err}")))?,
                _ = cancel.cancelled() => Ok(false),
            }
        }
    }
}
