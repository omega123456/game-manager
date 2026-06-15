//! Raise the running game's process priority while it plays.
//!
//! When a launch is detected the game process can be bumped to the Windows
//! `HIGH_PRIORITY_CLASS` so it gets preferential CPU scheduling (smoother frame
//! pacing). The OS-facing primitive ([`ProcessPrioritizer`]) is abstracted so the
//! enable/disable gating in [`AppState`](crate::state::AppState) is unit-testable
//! with a fake on every platform.
//!
//! Unlike keep-awake there is no reference counting or worker thread: setting a
//! process priority is a one-shot call that any thread may make.

use crate::error::AppResult;

/// OS primitive that raises a process's scheduling priority to High.
///
/// Implemented for real on Windows by [`WindowsProcessPrioritizer`] (via
/// `SetPriorityClass`) and as a no-op on other platforms / in tests by
/// [`NoopProcessPrioritizer`].
pub trait ProcessPrioritizer: Send + Sync {
    /// Raise the process identified by `pid` to the High priority class.
    fn set_high(&self, pid: u32) -> AppResult<()>;
}

/// A [`ProcessPrioritizer`] that does nothing — used on non-Windows targets and
/// in tests so no real OS process state is touched.
pub struct NoopProcessPrioritizer;

impl ProcessPrioritizer for NoopProcessPrioritizer {
    fn set_high(&self, _pid: u32) -> AppResult<()> {
        Ok(())
    }
}

/// The default OS prioritizer for the running platform.
#[cfg(windows)]
pub fn default_prioritizer() -> Box<dyn ProcessPrioritizer> {
    Box::new(windows_impl::WindowsProcessPrioritizer)
}

/// The default OS prioritizer for non-Windows targets (no-op).
#[cfg(not(windows))]
pub fn default_prioritizer() -> Box<dyn ProcessPrioritizer> {
    Box::new(NoopProcessPrioritizer)
}

// ----- Real Windows implementation (SetPriorityClass) -----------------------

#[cfg(windows)]
mod windows_impl {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, SetPriorityClass, HIGH_PRIORITY_CLASS, PROCESS_SET_INFORMATION,
    };

    use crate::error::{AppError, AppResult};

    use super::ProcessPrioritizer;

    /// Windows prioritizer backed by `OpenProcess` + `SetPriorityClass`.
    pub struct WindowsProcessPrioritizer;

    impl ProcessPrioritizer for WindowsProcessPrioritizer {
        fn set_high(&self, pid: u32) -> AppResult<()> {
            // SAFETY: OpenProcess returns an owned handle closed below on success.
            let handle = unsafe { OpenProcess(PROCESS_SET_INFORMATION, false, pid) }
                .map_err(|err| AppError::other(format!("OpenProcess({pid}) failed: {err}")))?;
            // SAFETY: `handle` is a valid process handle with SET_INFORMATION rights.
            let result = unsafe { SetPriorityClass(handle, HIGH_PRIORITY_CLASS) }
                .map_err(|err| AppError::other(format!("SetPriorityClass({pid}) failed: {err}")));
            // SAFETY: owned handle.
            let _ = unsafe { CloseHandle(handle) };
            result
        }
    }
}
