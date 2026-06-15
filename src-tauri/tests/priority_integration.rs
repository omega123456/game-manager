//! Process-priority controller + AppState wiring tests: the `raise_game_priority`
//! setting gate (default ON), and that the boost is best-effort.

use std::sync::{Arc, Mutex};

use game_manager_lib::error::AppResult;
use game_manager_lib::priority::{NoopProcessPrioritizer, ProcessPrioritizer};
use game_manager_lib::state::AppState;

/// A [`ProcessPrioritizer`] that records every pid passed to `set_high`. The list
/// is shared via `Arc` so the test can inspect it after the recorder has been
/// boxed into the `AppState`.
#[derive(Clone, Default)]
struct RecordingPrioritizer {
    pids: Arc<Mutex<Vec<u32>>>,
}

impl RecordingPrioritizer {
    fn pids(&self) -> Vec<u32> {
        self.pids.lock().unwrap().clone()
    }
}

impl ProcessPrioritizer for RecordingPrioritizer {
    fn set_high(&self, pid: u32) -> AppResult<()> {
        self.pids.lock().unwrap().push(pid);
        Ok(())
    }
}

#[test]
fn boosts_when_setting_is_unset_default_on() {
    let recorder = RecordingPrioritizer::default();
    let state = AppState::in_memory_with_prioritizer(Box::new(recorder.clone())).unwrap();

    state.raise_priority_if_enabled(4321);

    assert_eq!(recorder.pids(), vec![4321], "default ON when setting is unset");
}

#[test]
fn boosts_when_setting_is_true() {
    let recorder = RecordingPrioritizer::default();
    let state = AppState::in_memory_with_prioritizer(Box::new(recorder.clone())).unwrap();
    state
        .with_db(|conn| {
            game_manager_lib::db::repo::settings::set(conn, "raise_game_priority", "true")
        })
        .unwrap();

    state.raise_priority_if_enabled(99);

    assert_eq!(recorder.pids(), vec![99]);
}

#[test]
fn does_not_boost_when_setting_is_false() {
    let recorder = RecordingPrioritizer::default();
    let state = AppState::in_memory_with_prioritizer(Box::new(recorder.clone())).unwrap();
    state
        .with_db(|conn| {
            game_manager_lib::db::repo::settings::set(conn, "raise_game_priority", "false")
        })
        .unwrap();

    state.raise_priority_if_enabled(99);

    assert!(recorder.pids().is_empty(), "explicit false disables the boost");
}

#[test]
fn noop_prioritizer_is_inert() {
    let prioritizer = NoopProcessPrioritizer;
    assert!(prioritizer.set_high(1).is_ok());
}

#[cfg(windows)]
#[test]
fn windows_prioritizer_raises_a_real_child() {
    use game_manager_lib::priority::default_prioritizer;
    use std::process::Command;

    // Spawn `ping` directly (not via `cmd /c`) so `child.id()` is the pid of the
    // long-lived process we boost — avoiding a race where the cmd wrapper exits
    // before we open it. `-n 3` keeps it alive long enough to open and exits on
    // its own well under the test time budget.
    let mut child = Command::new("ping")
        .args(["127.0.0.1", "-n", "3"])
        .spawn()
        .expect("spawn child process");

    let prioritizer = default_prioritizer();
    let result = prioritizer.set_high(child.id());

    let _ = child.kill();
    let _ = child.wait();

    result.expect("SetPriorityClass on an owned child should succeed");
}
