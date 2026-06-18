//! Keep-awake controller + AppState wiring tests: reference-counted engage /
//! release behaviour and that registering a launch suppresses system sleep.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use game_manager_lib::error::AppResult;
use game_manager_lib::keep_awake::{KeepAwake, NoopSleepBlocker, SleepBlocker};
use game_manager_lib::state::AppState;

/// A [`SleepBlocker`] that counts engage / release calls so tests can assert the
/// reference-counting transitions. Counters are shared via `Arc` so the test can
/// inspect them after the blocker has been boxed into [`KeepAwake`].
#[derive(Clone, Default)]
struct RecordingBlocker {
    engaged: Arc<AtomicUsize>,
    released: Arc<AtomicUsize>,
}

impl RecordingBlocker {
    fn engaged(&self) -> usize {
        self.engaged.load(Ordering::SeqCst)
    }

    fn released(&self) -> usize {
        self.released.load(Ordering::SeqCst)
    }
}

impl SleepBlocker for RecordingBlocker {
    fn engage(&self) -> AppResult<()> {
        self.engaged.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn release(&self) -> AppResult<()> {
        self.released.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

#[test]
fn keep_awake_engages_once_across_overlapping_acquires() {
    let recorder = RecordingBlocker::default();
    let keep_awake = KeepAwake::new(Box::new(recorder.clone()));

    keep_awake.acquire();
    keep_awake.acquire();
    assert_eq!(recorder.engaged(), 1, "engage only on the 0->1 transition");
    assert_eq!(recorder.released(), 0);

    keep_awake.release();
    assert_eq!(recorder.released(), 0, "still one active launch");
    keep_awake.release();
    assert_eq!(recorder.released(), 1, "release on the 1->0 transition");
}

#[test]
fn keep_awake_release_without_acquire_is_a_noop() {
    let recorder = RecordingBlocker::default();
    let keep_awake = KeepAwake::new(Box::new(recorder.clone()));

    keep_awake.release();
    assert_eq!(recorder.released(), 0, "no release when nothing is active");
}

#[test]
fn registering_a_launch_engages_keep_awake_until_unregister() {
    let recorder = RecordingBlocker::default();
    let state = AppState::in_memory_with_blocker(Box::new(recorder.clone())).unwrap();

    let _token = state.register_launch(7).unwrap();
    assert_eq!(
        recorder.engaged(),
        1,
        "registering a launch keeps the system awake"
    );
    assert_eq!(recorder.released(), 0);

    state.unregister_launch(7);
    assert_eq!(
        recorder.released(),
        1,
        "sleep restored once the launch ends"
    );

    // Unregistering again must not release a second time.
    state.unregister_launch(7);
    assert_eq!(recorder.released(), 1);
}

#[test]
fn noop_blocker_is_inert() {
    let blocker = NoopSleepBlocker;
    assert!(blocker.engage().is_ok());
    assert!(blocker.release().is_ok());
}

#[cfg(windows)]
#[test]
fn windows_blocker_engages_releases_and_shuts_down_cleanly() {
    use game_manager_lib::keep_awake::default_blocker;

    let blocker = default_blocker();
    blocker.engage().unwrap();
    blocker.release().unwrap();
    // Dropping closes the worker channel and joins the thread, which clears the
    // execution-state request on the same thread that set it.
    drop(blocker);
}
