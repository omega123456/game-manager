//! Mode A (job-object tree) monitor integration tests.
//!
//! The launch/wait/session-writing logic is exercised cross-platform with a fake
//! [`JobLauncher`]/[`JobHandle`]; one Windows-gated test launches a real
//! short-lived child into a real job object and times the tree to exit on
//! `ACTIVE_PROCESS_ZERO`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;

use game_manager_lib::db::repo::{games, sessions};
use game_manager_lib::domain::MonitorMode;
use game_manager_lib::launch::cancel::CancelToken;
use game_manager_lib::monitor::job_object::{
    split_arguments, JobHandle, JobLauncher, JobObjectMonitor,
    JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO, JOB_OBJECT_MSG_EXIT_PROCESS, JOB_OBJECT_MSG_NEW_PROCESS,
};
use game_manager_lib::monitor::{Monitor, StartOutcome};
use game_manager_lib::state::AppState;

// ----- constants + argument splitting ---------------------------------------

#[test]
fn job_object_msg_constants_have_documented_values() {
    assert_eq!(JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO, 4);
    assert_eq!(JOB_OBJECT_MSG_NEW_PROCESS, 6);
    assert_eq!(JOB_OBJECT_MSG_EXIT_PROCESS, 7);
}

#[test]
fn splits_arguments_honoring_quotes() {
    assert!(split_arguments(None).is_empty());
    assert!(split_arguments(Some("   ")).is_empty());
    assert_eq!(split_arguments(Some("-a -b")), vec!["-a", "-b"]);
    assert_eq!(
        split_arguments(Some(r#"--path "C:\Program Files\x" --flag"#)),
        vec!["--path", r"C:\Program Files\x", "--flag"]
    );
}

// ----- fake launcher / handle -----------------------------------------------

/// Pid the fake launcher reports for the process it "launches", so tests can
/// assert it is the value handed to the priority boost.
const FAKE_LAUNCH_PID: u32 = 4242;

/// Tiny confirmation grace period so the cross-platform tests stay fast while
/// still exercising the confirm-before-start path.
const TEST_CONFIRM_DELAY: Duration = Duration::from_millis(10);

struct FakeHandle {
    pid: u32,
    exit_after: Duration,
    active_processes: u32,
    waited: Arc<AtomicBool>,
}

#[async_trait]
impl JobHandle for FakeHandle {
    fn pid(&self) -> u32 {
        self.pid
    }

    fn active_process_count(&self) -> game_manager_lib::error::AppResult<u32> {
        Ok(self.active_processes)
    }

    async fn wait_for_tree_exit(&self, cancel: &CancelToken) -> game_manager_lib::error::AppResult<bool> {
        self.waited.store(true, Ordering::SeqCst);
        tokio::select! {
            _ = tokio::time::sleep(self.exit_after) => Ok(true),
            _ = cancel.cancelled() => Ok(false),
        }
    }
}

struct FakeLauncher {
    exit_after: Duration,
    last_target: Arc<std::sync::Mutex<Option<String>>>,
    waited: Arc<AtomicBool>,
    fail: bool,
    /// Live process count the launched handle reports during confirmation. Set
    /// to 1 for a normal game; 0 simulates a transient bootstrapper whose tree
    /// empties before confirmation.
    active_processes: u32,
}

impl JobLauncher for FakeLauncher {
    type Handle = FakeHandle;

    fn launch(
        &self,
        launch_target: &str,
        _arguments: Option<&str>,
    ) -> game_manager_lib::error::AppResult<Self::Handle> {
        if self.fail {
            return Err(game_manager_lib::error::AppError::other("boom"));
        }
        *self.last_target.lock().unwrap() = Some(launch_target.to_string());
        Ok(FakeHandle {
            pid: FAKE_LAUNCH_PID,
            exit_after: self.exit_after,
            active_processes: self.active_processes,
            waited: self.waited.clone(),
        })
    }
}

fn seed_tree_game(state: &AppState, launch_target: &str) -> i64 {
    state
        .with_db(|conn| {
            games::create(
                conn,
                &games::NewGame {
                    name: "TreeGame".to_string(),
                    launch_target: launch_target.to_string(),
                    monitor_mode: MonitorMode::Tree,
                    monitor_process_name: None,
                    arguments: None,
                    image_path: None,
                },
            )
        })
        .unwrap()
}

#[tokio::test]
async fn launches_tree_and_writes_accurate_session() {
    let state = AppState::in_memory().unwrap();
    let game_id = seed_tree_game(&state, "C:/Games/Direct.exe");

    let last_target = Arc::new(std::sync::Mutex::new(None));
    let waited = Arc::new(AtomicBool::new(false));
    let monitor = JobObjectMonitor::new(FakeLauncher {
        exit_after: Duration::from_millis(20),
        last_target: last_target.clone(),
        waited: waited.clone(),
        fail: false,
        active_processes: 1,
    })
    .with_confirm_delay(TEST_CONFIRM_DELAY);
    let cancel = CancelToken::new();

    let session_id = match monitor.wait_for_start(&state, game_id, &cancel).await.unwrap() {
        StartOutcome::Started(id) => id,
        StartOutcome::Cancelled => panic!("expected start"),
    };
    assert_eq!(*last_target.lock().unwrap(), Some("C:/Games/Direct.exe".to_string()));

    let elapsed = monitor.wait_for_end(&state, session_id, &cancel).await.unwrap();
    assert!(elapsed >= 0);
    assert!(waited.load(Ordering::SeqCst), "wait_for_tree_exit must be invoked");

    let sessions = state.with_db(|conn| sessions::list_for_game(conn, game_id)).unwrap();
    assert_eq!(sessions.len(), 1);
    assert!(sessions[0].ended_at.is_some());
}

#[tokio::test]
async fn raises_launched_process_priority_on_start() {
    use std::sync::Mutex as StdMutex;

    #[derive(Clone, Default)]
    struct RecordingPrioritizer {
        pids: Arc<StdMutex<Vec<u32>>>,
    }
    impl game_manager_lib::priority::ProcessPrioritizer for RecordingPrioritizer {
        fn set_high(&self, pid: u32) -> game_manager_lib::error::AppResult<()> {
            self.pids.lock().unwrap().push(pid);
            Ok(())
        }
    }

    let recorder = RecordingPrioritizer::default();
    let state = AppState::in_memory_with_prioritizer(Box::new(recorder.clone())).unwrap();
    let game_id = seed_tree_game(&state, "C:/Games/Direct.exe");

    let monitor = JobObjectMonitor::new(FakeLauncher {
        exit_after: Duration::from_millis(20),
        last_target: Arc::new(std::sync::Mutex::new(None)),
        waited: Arc::new(AtomicBool::new(false)),
        fail: false,
        active_processes: 1,
    })
    .with_confirm_delay(TEST_CONFIRM_DELAY);
    let cancel = CancelToken::new();
    monitor.wait_for_start(&state, game_id, &cancel).await.unwrap();

    assert_eq!(
        *recorder.pids.lock().unwrap(),
        vec![FAKE_LAUNCH_PID],
        "the launched process pid must be boosted on start"
    );
}

#[tokio::test]
async fn cancellation_during_wait_still_closes_session() {
    let state = AppState::in_memory().unwrap();
    let game_id = seed_tree_game(&state, "C:/Games/LongRun.exe");

    let monitor = JobObjectMonitor::new(FakeLauncher {
        exit_after: Duration::from_secs(30), // would block; cancel wins.
        last_target: Arc::new(std::sync::Mutex::new(None)),
        waited: Arc::new(AtomicBool::new(false)),
        fail: false,
        active_processes: 1,
    })
    .with_confirm_delay(TEST_CONFIRM_DELAY);
    let cancel = CancelToken::new();
    let session_id = match monitor.wait_for_start(&state, game_id, &cancel).await.unwrap() {
        StartOutcome::Started(id) => id,
        StartOutcome::Cancelled => panic!("expected start"),
    };
    cancel.cancel();
    let elapsed = monitor.wait_for_end(&state, session_id, &cancel).await.unwrap();
    assert!(elapsed >= 0);

    let sessions = state.with_db(|conn| sessions::list_for_game(conn, game_id)).unwrap();
    assert!(sessions[0].ended_at.is_some(), "cancel must still close the session");
}

#[tokio::test]
async fn transient_tree_opens_no_session_and_skips_priority_boost() {
    use std::sync::Mutex as StdMutex;

    #[derive(Clone, Default)]
    struct RecordingPrioritizer {
        pids: Arc<StdMutex<Vec<u32>>>,
    }
    impl game_manager_lib::priority::ProcessPrioritizer for RecordingPrioritizer {
        fn set_high(&self, pid: u32) -> game_manager_lib::error::AppResult<()> {
            self.pids.lock().unwrap().push(pid);
            Ok(())
        }
    }

    // A bootstrapper: the launched tree reports zero live processes by the time
    // confirmation runs (it exited and handed off to a detached launcher).
    let recorder = RecordingPrioritizer::default();
    let state = AppState::in_memory_with_prioritizer(Box::new(recorder.clone())).unwrap();
    let game_id = seed_tree_game(&state, "C:/Games/Bootstrapper.exe");

    let waited = Arc::new(AtomicBool::new(false));
    let monitor = JobObjectMonitor::new(FakeLauncher {
        exit_after: Duration::ZERO,
        last_target: Arc::new(std::sync::Mutex::new(None)),
        waited: waited.clone(),
        fail: false,
        active_processes: 0,
    })
    .with_confirm_delay(TEST_CONFIRM_DELAY);
    let cancel = CancelToken::new();

    let outcome = monitor.wait_for_start(&state, game_id, &cancel).await.unwrap();
    assert_eq!(
        outcome,
        StartOutcome::Cancelled,
        "a tree that empties during confirmation must not be treated as started"
    );
    let sessions = state.with_db(|conn| sessions::list_for_game(conn, game_id)).unwrap();
    assert!(sessions.is_empty(), "no session opened for a transient bootstrapper");
    assert!(
        recorder.pids.lock().unwrap().is_empty(),
        "priority must not be raised for a transient process"
    );
    assert!(
        !waited.load(Ordering::SeqCst),
        "the tree-exit wait must not run when the launch was never confirmed"
    );
}

#[tokio::test]
async fn cancel_before_start_opens_no_session() {
    let state = AppState::in_memory().unwrap();
    let game_id = seed_tree_game(&state, "C:/Games/X.exe");
    let monitor = JobObjectMonitor::new(FakeLauncher {
        exit_after: Duration::ZERO,
        last_target: Arc::new(std::sync::Mutex::new(None)),
        waited: Arc::new(AtomicBool::new(false)),
        fail: false,
        active_processes: 1,
    });
    let cancel = CancelToken::new();
    cancel.cancel();
    let outcome = monitor.wait_for_start(&state, game_id, &cancel).await.unwrap();
    assert_eq!(outcome, StartOutcome::Cancelled);
    let sessions = state.with_db(|conn| sessions::list_for_game(conn, game_id)).unwrap();
    assert!(sessions.is_empty());
}

#[tokio::test]
async fn launch_failure_propagates() {
    let state = AppState::in_memory().unwrap();
    let game_id = seed_tree_game(&state, "C:/Games/Bad.exe");
    let monitor = JobObjectMonitor::new(FakeLauncher {
        exit_after: Duration::ZERO,
        last_target: Arc::new(std::sync::Mutex::new(None)),
        waited: Arc::new(AtomicBool::new(false)),
        fail: true,
        active_processes: 0,
    });
    let cancel = CancelToken::new();
    let result = monitor.wait_for_start(&state, game_id, &cancel).await;
    assert!(result.is_err(), "a failed launch must surface as an error");
    let sessions = state.with_db(|conn| sessions::list_for_game(conn, game_id)).unwrap();
    assert!(sessions.is_empty(), "no session when launch fails");
}

#[tokio::test]
async fn wait_for_end_without_parked_handle_still_closes() {
    // Exercise the "no parked handle" branch (e.g. a stale session id).
    let state = AppState::in_memory().unwrap();
    let game_id = seed_tree_game(&state, "C:/Games/Y.exe");
    let monitor = JobObjectMonitor::new(FakeLauncher {
        exit_after: Duration::ZERO,
        last_target: Arc::new(std::sync::Mutex::new(None)),
        waited: Arc::new(AtomicBool::new(false)),
        fail: false,
        active_processes: 1,
    });
    // Open a session directly, then call wait_for_end with no parked handle.
    let session_id = state.with_db(|conn| sessions::start(conn, game_id)).unwrap();
    let cancel = CancelToken::new();
    let elapsed = monitor.wait_for_end(&state, session_id, &cancel).await.unwrap();
    assert!(elapsed >= 0);
    let sessions = state.with_db(|conn| sessions::list_for_game(conn, game_id)).unwrap();
    assert!(sessions[0].ended_at.is_some());
}

// ----- Windows-gated real-process test --------------------------------------

#[cfg(windows)]
#[tokio::test]
async fn windows_times_a_real_tree_to_exit() {
    use game_manager_lib::monitor::job_object::windows_monitor;

    let state = AppState::in_memory().unwrap();
    // A short-lived process tree: cmd spawns ping which exits quickly.
    let game_id = state
        .with_db(|conn| {
            games::create(
                conn,
                &games::NewGame {
                    name: "DirectGame".to_string(),
                    launch_target: "cmd.exe".to_string(),
                    monitor_mode: MonitorMode::Tree,
                    monitor_process_name: None,
                    arguments: Some("/c ping -n 2 127.0.0.1".to_string()),
                    image_path: None,
                },
            )
        })
        .unwrap();

    // Short confirmation window: the cmd/ping tree lives ~1s, comfortably longer
    // than the grace period, so it confirms rather than being treated transient.
    let monitor = windows_monitor().with_confirm_delay(Duration::from_millis(200));
    let cancel = CancelToken::new();
    let session_id = match monitor.wait_for_start(&state, game_id, &cancel).await.unwrap() {
        StartOutcome::Started(id) => id,
        StartOutcome::Cancelled => panic!("expected start"),
    };
    let elapsed = monitor.wait_for_end(&state, session_id, &cancel).await.unwrap();
    assert!(elapsed >= 0);

    let sessions = state.with_db(|conn| sessions::list_for_game(conn, game_id)).unwrap();
    assert_eq!(sessions.len(), 1);
    assert!(sessions[0].ended_at.is_some());
}
