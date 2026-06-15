//! Keep the machine awake while a game is running.
//!
//! Sleep is suppressed for the whole time any launch is active. The OS-facing
//! primitive ([`SleepBlocker`]) is abstracted so the reference-counting logic in
//! [`KeepAwake`] is unit-testable with a fake on every platform.
//!
//! The real Windows implementation drives `SetThreadExecutionState`, whose
//! request is **per-thread** and is cleared automatically when the requesting
//! thread exits. Because a launch is engaged on the command thread but released
//! later from an async task (a different thread), all calls are funnelled onto a
//! single long-lived worker thread so the request is set and cleared on the same
//! thread and never dropped while a game is still running.

use std::sync::Mutex;

use crate::error::AppResult;

/// OS primitive that suppresses (and restores) system sleep.
///
/// Implemented for real on Windows by [`WindowsSleepBlocker`] and as a no-op on
/// other platforms / in tests by [`NoopSleepBlocker`].
pub trait SleepBlocker: Send + Sync {
    /// Engage the keep-awake request so the system stays awake.
    fn engage(&self) -> AppResult<()>;

    /// Release the keep-awake request so the system may sleep again.
    fn release(&self) -> AppResult<()>;
}

/// Reference-counted keep-awake controller.
///
/// [`acquire`](Self::acquire) engages the blocker on the 0→1 transition and
/// [`release`](Self::release) releases it on the 1→0 transition, so overlapping
/// callers never engage or release more than once.
pub struct KeepAwake {
    blocker: Box<dyn SleepBlocker>,
    active: Mutex<usize>,
}

impl KeepAwake {
    /// Construct a controller over the given OS blocker.
    pub fn new(blocker: Box<dyn SleepBlocker>) -> Self {
        KeepAwake {
            blocker,
            active: Mutex::new(0),
        }
    }

    /// Record a new active launch, engaging the blocker on the first one.
    pub fn acquire(&self) {
        let Ok(mut count) = self.active.lock() else {
            return;
        };
        *count += 1;
        if *count == 1 {
            if let Err(err) = self.blocker.engage() {
                tracing::warn!(category = "launch", "failed to engage keep-awake: {err}");
            }
        }
    }

    /// Record a finished launch, releasing the blocker once the last one ends.
    pub fn release(&self) {
        let Ok(mut count) = self.active.lock() else {
            return;
        };
        if *count == 0 {
            return;
        }
        *count -= 1;
        if *count == 0 {
            if let Err(err) = self.blocker.release() {
                tracing::warn!(category = "launch", "failed to release keep-awake: {err}");
            }
        }
    }
}

/// A [`SleepBlocker`] that does nothing — used on non-Windows targets and in
/// tests so no real OS sleep state is touched.
pub struct NoopSleepBlocker;

impl SleepBlocker for NoopSleepBlocker {
    fn engage(&self) -> AppResult<()> {
        Ok(())
    }

    fn release(&self) -> AppResult<()> {
        Ok(())
    }
}

/// The default OS blocker for the running platform.
#[cfg(windows)]
pub fn default_blocker() -> Box<dyn SleepBlocker> {
    Box::new(windows_impl::WindowsSleepBlocker::new())
}

/// The default OS blocker for non-Windows targets (no-op).
#[cfg(not(windows))]
pub fn default_blocker() -> Box<dyn SleepBlocker> {
    Box::new(NoopSleepBlocker)
}

// ----- Real Windows implementation (SetThreadExecutionState) ----------------

#[cfg(windows)]
mod windows_impl {
    use std::sync::mpsc::{channel, Sender};
    use std::sync::Mutex;
    use std::thread::JoinHandle;

    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED, EXECUTION_STATE,
    };

    use crate::error::{AppError, AppResult};

    use super::SleepBlocker;

    /// Messages sent to the dedicated keep-awake worker thread.
    enum Msg {
        Engage,
        Release,
    }

    /// Windows blocker backed by a single worker thread that owns every
    /// `SetThreadExecutionState` call (the request is per-thread, so set and
    /// clear must share one long-lived thread).
    pub struct WindowsSleepBlocker {
        tx: Mutex<Option<Sender<Msg>>>,
        worker: Mutex<Option<JoinHandle<()>>>,
    }

    impl WindowsSleepBlocker {
        /// Spawn the worker thread and return a handle that talks to it.
        pub fn new() -> Self {
            let (tx, rx) = channel::<Msg>();
            let worker = std::thread::Builder::new()
                .name("keep-awake".to_string())
                .spawn(move || {
                    for msg in rx {
                        match msg {
                            Msg::Engage => set_state(ES_CONTINUOUS | ES_SYSTEM_REQUIRED),
                            Msg::Release => set_state(ES_CONTINUOUS),
                        }
                    }
                    // Channel closed (blocker dropped): clear any request before exit.
                    set_state(ES_CONTINUOUS);
                })
                .expect("spawn keep-awake worker thread");
            WindowsSleepBlocker {
                tx: Mutex::new(Some(tx)),
                worker: Mutex::new(Some(worker)),
            }
        }

        fn send(&self, msg: Msg) -> AppResult<()> {
            let guard = self
                .tx
                .lock()
                .map_err(|_| AppError::other("keep-awake sender mutex poisoned"))?;
            match guard.as_ref() {
                Some(tx) => tx
                    .send(msg)
                    .map_err(|err| AppError::other(format!("keep-awake worker gone: {err}"))),
                None => Err(AppError::other("keep-awake worker already shut down")),
            }
        }
    }

    impl SleepBlocker for WindowsSleepBlocker {
        fn engage(&self) -> AppResult<()> {
            self.send(Msg::Engage)
        }

        fn release(&self) -> AppResult<()> {
            self.send(Msg::Release)
        }
    }

    impl Drop for WindowsSleepBlocker {
        fn drop(&mut self) {
            // Drop the sender to close the channel, then join so the worker has
            // cleared the request before we return.
            if let Ok(mut guard) = self.tx.lock() {
                guard.take();
            }
            if let Ok(mut guard) = self.worker.lock() {
                if let Some(handle) = guard.take() {
                    let _ = handle.join();
                }
            }
        }
    }

    /// Apply an execution-state flag set, logging on failure.
    fn set_state(state: EXECUTION_STATE) {
        // SAFETY: `SetThreadExecutionState` takes a flag bitmask by value and
        // returns the previous state (0 on failure); no pointers or handles.
        let previous = unsafe { SetThreadExecutionState(state) };
        if previous == EXECUTION_STATE(0) {
            tracing::warn!(category = "launch", "SetThreadExecutionState failed");
        }
    }
}
