//! Mode B — named-process monitoring.
//!
//! For store/launcher games the timed process is **not** a descendant of what we
//! launch (the launcher/bootstrapper hands off to a detached game process). The
//! game is timed by polling the OS process table for the configured real-exe
//! process name; once it appears the session opens, and we wait for that exact
//! process to exit before closing the session.
//!
//! The OS-facing primitive (snapshot the process table; wait for a pid to exit)
//! is abstracted behind [`ProcessTable`] so the poll loop, name normalization,
//! cancellation handling and session-writing logic are unit-testable with a fake
//! on every platform. The real Windows ToolHelp / `OpenProcess` implementation
//! ([`WindowsProcessTable`]) is compiled only on Windows and is the only part
//! that touches raw FFI.

use std::process::Command;
use std::time::Duration;

use async_trait::async_trait;

use super::job_object::split_arguments;
use super::stub::elapsed_seconds;
use super::{Monitor, StartOutcome};
use crate::db::repo::{games, sessions};
use crate::error::{AppError, AppResult};
use crate::launch::cancel::CancelToken;
use crate::state::AppState;

/// How often the process table is polled while waiting for the named process to
/// appear. Short enough to feel responsive; well under the 5s test ceiling.
const POLL_INTERVAL: Duration = Duration::from_millis(500);

/// How long a freshly-detected process must stay alive before it is treated as
/// the real game. Store/launcher bootstrappers spawn a short-lived process that
/// matches the configured name for a split second, then exit as the launcher
/// takes over. Without this grace period the session (and the After-Process
/// scripts) would fire against that transient bootstrapper rather than the game.
const DEFAULT_CONFIRM_DELAY: Duration = Duration::from_secs(3);

/// Abstraction over the OS process table used by Mode B.
///
/// Implemented for real by [`WindowsProcessTable`] (ToolHelp snapshot +
/// `OpenProcess`/`WaitForSingleObject`) and by fakes in tests, so the poll loop
/// logic is exercised without spawning real processes.
#[async_trait]
pub trait ProcessTable: Send + Sync {
    /// Return the pids of all running processes whose image name matches
    /// `normalized_name` (already lower-cased, `.exe`-suffixed).
    fn find_pids_by_name(&self, normalized_name: &str) -> AppResult<Vec<u32>>;

    /// Block until the process identified by `pid` exits, or `cancel` fires.
    ///
    /// Returns `true` if the process exited; `false` if cancellation won the race
    /// (or the process could not be opened, treated as already-gone best-effort).
    async fn wait_for_exit(&self, pid: u32, cancel: &CancelToken) -> AppResult<bool>;
}

/// Abstraction over how Mode B launches the configured target before polling
/// for the real game process name.
pub trait NamedProcessLauncher: Send + Sync {
    /// Launch the configured `launch_target` with optional stored arguments.
    fn launch(&self, launch_target: &str, arguments: Option<&str>) -> AppResult<()>;
}

/// Normalize a configured monitor process name to the comparison form: trim the
/// directory, lower-case, and ensure a trailing `.exe`.
///
/// Accepts a bare name (`Game`), a name with extension (`Game.exe`), or a full
/// path (`C:\\Games\\Game.exe`) and yields `game.exe`.
pub fn normalize_process_name(raw: &str) -> String {
    let trimmed = raw.trim().trim_matches('"');
    // Take the final path component (handle both separators defensively).
    let base = trimmed
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(trimmed)
        .trim();
    let lowered = base.to_ascii_lowercase();
    if lowered.is_empty() {
        return lowered;
    }
    if lowered.ends_with(".exe") {
        lowered
    } else {
        format!("{lowered}.exe")
    }
}

/// Sleep for `POLL_INTERVAL`, returning early (`true`) if cancelled first.
async fn poll_delay_or_cancel(cancel: &CancelToken) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(POLL_INTERVAL) => cancel.is_cancelled(),
        _ = cancel.cancelled() => true,
    }
}

/// Outcome of waiting out the confirmation grace period on a candidate pid.
enum ConfirmOutcome {
    /// The candidate was still alive after the grace period: it is the game.
    Confirmed,
    /// The candidate exited during the grace period (a transient bootstrapper).
    Vanished,
    /// Cancellation won the race during the grace period.
    Cancelled,
}

/// Mode B monitor: times a named (store/launcher) game process.
pub struct NamedProcessMonitor<T: ProcessTable, L: NamedProcessLauncher = WindowsNamedProcessLauncher>
{
    table: T,
    launcher: L,
    confirm_delay: Duration,
}

impl<T: ProcessTable, L: NamedProcessLauncher> NamedProcessMonitor<T, L> {
    /// Construct a Mode B monitor over the given process-table primitive.
    pub fn new(table: T, launcher: L) -> Self {
        NamedProcessMonitor {
            table,
            launcher,
            confirm_delay: DEFAULT_CONFIRM_DELAY,
        }
    }

    /// Override the post-detection confirmation grace period (defaults to
    /// [`DEFAULT_CONFIRM_DELAY`]). Tests use a tiny value to stay fast.
    pub fn with_confirm_delay(mut self, confirm_delay: Duration) -> Self {
        self.confirm_delay = confirm_delay;
        self
    }

    /// Wait out the confirmation grace period, then re-check that `pid` is still
    /// running under `target`. Used to reject transient launcher bootstrappers
    /// that match the configured name for only a split second.
    async fn confirm_still_running(
        &self,
        target: &str,
        pid: u32,
        cancel: &CancelToken,
    ) -> AppResult<ConfirmOutcome> {
        tokio::select! {
            _ = tokio::time::sleep(self.confirm_delay) => {}
            _ = cancel.cancelled() => return Ok(ConfirmOutcome::Cancelled),
        }
        if cancel.is_cancelled() {
            return Ok(ConfirmOutcome::Cancelled);
        }
        if self.table.find_pids_by_name(target)?.contains(&pid) {
            Ok(ConfirmOutcome::Confirmed)
        } else {
            Ok(ConfirmOutcome::Vanished)
        }
    }
}

/// Construct the default Windows-backed Mode B monitor.
#[cfg(windows)]
pub fn windows_monitor() -> NamedProcessMonitor<WindowsProcessTable, WindowsNamedProcessLauncher> {
    NamedProcessMonitor::new(WindowsProcessTable, WindowsNamedProcessLauncher)
}

#[async_trait]
impl<T: ProcessTable, L: NamedProcessLauncher> Monitor for NamedProcessMonitor<T, L> {
    async fn wait_for_start(
        &self,
        state: &AppState,
        game_id: i64,
        cancel: &CancelToken,
    ) -> AppResult<StartOutcome> {
        let game = state.with_db(|conn| games::get(conn, game_id))?;
        let raw = game.monitor_process_name.ok_or_else(|| {
            AppError::other(format!(
                "game {game_id} uses named monitoring but has no monitor_process_name"
            ))
        })?;
        let target = normalize_process_name(&raw);
        if target.is_empty() {
            return Err(AppError::other(format!(
                "game {game_id} has an empty monitor_process_name"
            )));
        }
        if cancel.is_cancelled() {
            return Ok(StartOutcome::Cancelled);
        }

        let existing_pids = self.table.find_pids_by_name(&target)?;

        self.launcher
            .launch(&game.launch_target, game.arguments.as_deref())?;

        // Poll until the configured process appears, survives the confirmation
        // grace period, or we are cancelled.
        loop {
            if cancel.is_cancelled() {
                return Ok(StartOutcome::Cancelled);
            }
            if let Some(pid) = self
                .table
                .find_pids_by_name(&target)?
                .into_iter()
                .find(|pid| !existing_pids.contains(pid))
            {
                // A matching process appeared, but it may be a short-lived
                // launcher bootstrapper. Only treat it as the game once it has
                // stayed alive through the confirmation grace period.
                match self.confirm_still_running(&target, pid, cancel).await? {
                    ConfirmOutcome::Confirmed => {
                        let session_id = state.with_db(|conn| sessions::start(conn, game_id))?;
                        tracing::info!(
                            category = "monitor",
                            "named-process '{target}' confirmed (pid {pid}); session {session_id} started"
                        );
                        // The detected process is the real game (the launcher has
                        // handed off), so this is the right pid to bump priority.
                        state.raise_priority_if_enabled(pid);
                        return Ok(StartOutcome::Started(encode_pid_session(session_id, pid)));
                    }
                    ConfirmOutcome::Cancelled => return Ok(StartOutcome::Cancelled),
                    ConfirmOutcome::Vanished => {
                        tracing::info!(
                            category = "monitor",
                            "named-process '{target}' (pid {pid}) exited during confirmation; \
                             treating as a transient launcher process and continuing to poll"
                        );
                        // Fall through to keep polling for the real game process.
                    }
                }
            }
            if poll_delay_or_cancel(cancel).await {
                return Ok(StartOutcome::Cancelled);
            }
        }
    }

    async fn wait_for_end(
        &self,
        state: &AppState,
        session_token: i64,
        cancel: &CancelToken,
    ) -> AppResult<i64> {
        let (session_id, pid) = decode_pid_session(session_token);
        // Wait for the exact detected process to exit (or cancellation). Either
        // way we close the session so the row is never left dangling.
        if let Err(err) = self.table.wait_for_exit(pid, cancel).await {
            tracing::warn!(
                category = "monitor",
                "named-process wait_for_exit(pid {pid}) failed: {err}; closing session anyway"
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

/// The real Windows launch primitive for Mode B.
pub struct WindowsNamedProcessLauncher;

impl NamedProcessLauncher for WindowsNamedProcessLauncher {
    fn launch(&self, launch_target: &str, arguments: Option<&str>) -> AppResult<()> {
        if launch_target.contains("://") {
            let mut command = Command::new("cmd.exe");
            command.args(["/c", "start", "", launch_target]);
            for arg in split_arguments(arguments) {
                command.arg(arg);
            }
            command.spawn().map_err(|err| {
                AppError::Io(format!("spawn 'cmd.exe /c start {launch_target}' failed: {err}"))
            })?;
            return Ok(());
        }

        let mut command = Command::new(launch_target);
        for arg in split_arguments(arguments) {
            command.arg(arg);
        }
        command
            .spawn()
            .map(|_| ())
            .map_err(|err| AppError::Io(format!("spawn '{launch_target}' failed: {err}")))
    }
}

/// Pack a `session_id` + `pid` into the single `i64` the [`Monitor`] trait
/// carries between `wait_for_start` and `wait_for_end` (the trait intentionally
/// passes only an opaque token, so Mode B threads the detected pid through it).
fn encode_pid_session(session_id: i64, pid: u32) -> i64 {
    (session_id << 32) | (pid as i64)
}

/// Inverse of [`encode_pid_session`].
fn decode_pid_session(token: i64) -> (i64, u32) {
    let session_id = token >> 32;
    let pid = (token & 0xFFFF_FFFF) as u32;
    (session_id, pid)
}

// ----- Real Windows implementation (ToolHelp + OpenProcess) -----------------

/// The real Windows process table backed by ToolHelp snapshots and `OpenProcess`
/// / `WaitForSingleObject`. The only Mode B code that touches raw FFI.
#[cfg(windows)]
pub struct WindowsProcessTable;

#[cfg(windows)]
#[async_trait]
impl ProcessTable for WindowsProcessTable {
    fn find_pids_by_name(&self, normalized_name: &str) -> AppResult<Vec<u32>> {
        windows_impl::find_pids_by_name(normalized_name)
    }

    async fn wait_for_exit(&self, pid: u32, cancel: &CancelToken) -> AppResult<bool> {
        // Run the blocking wait on a dedicated thread, racing cancellation.
        let pid_copy = pid;
        let handle = tokio::task::spawn_blocking(move || windows_impl::wait_for_exit_blocking(pid_copy));
        tokio::select! {
            joined = handle => joined
                .map_err(|err| AppError::other(format!("wait_for_exit task panicked: {err}")))?,
            _ = cancel.cancelled() => Ok(false),
        }
    }
}

#[cfg(windows)]
mod windows_impl {
    use crate::error::{AppError, AppResult};

    use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };

    /// Read a fixed-width UTF-16 `szExeFile` field into a lower-cased String.
    fn exe_name_lower(entry: &PROCESSENTRY32W) -> String {
        let raw = &entry.szExeFile;
        let len = raw.iter().position(|&c| c == 0).unwrap_or(raw.len());
        String::from_utf16_lossy(&raw[..len]).to_ascii_lowercase()
    }

    /// Snapshot the process table and return all pids matching `name`.
    pub(super) fn find_pids_by_name(name: &str) -> AppResult<Vec<u32>> {
        // SAFETY: ToolHelp snapshot is created and always closed below.
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
            .map_err(|err| AppError::other(format!("CreateToolhelp32Snapshot failed: {err}")))?;

        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        let result = (|| -> AppResult<Vec<u32>> {
            let mut matches = Vec::new();
            // SAFETY: `snapshot` is valid; `entry.dwSize` is set as required.
            if unsafe { Process32FirstW(snapshot, &mut entry) }.is_err() {
                return Ok(matches);
            }
            loop {
                if exe_name_lower(&entry) == name {
                    matches.push(entry.th32ProcessID);
                }
                // SAFETY: same snapshot/entry contract as the first call.
                if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                    return Ok(matches);
                }
            }
        })();

        // SAFETY: snapshot handle is non-null and owned here.
        let _ = unsafe { CloseHandle(snapshot) };
        result
    }

    /// Block until the process `pid` exits. Returns `true` on exit; `true` also
    /// when the process cannot be opened (already gone — best-effort).
    pub(super) fn wait_for_exit_blocking(pid: u32) -> AppResult<bool> {
        // SAFETY: OpenProcess returns an owned handle closed below on success.
        let handle: HANDLE = match unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) } {
            Ok(handle) => handle,
            // The process is already gone (or inaccessible): treat as exited.
            Err(_) => return Ok(true),
        };
        // SAFETY: `handle` is a valid process handle; INFINITE wait.
        let status = unsafe { WaitForSingleObject(handle, u32::MAX) };
        // SAFETY: handle owned here.
        let _ = unsafe { CloseHandle(handle) };
        Ok(status == WAIT_OBJECT_0)
    }
}
