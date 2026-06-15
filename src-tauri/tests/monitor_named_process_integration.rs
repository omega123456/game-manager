//! Mode B (named-process) monitor integration tests.
//!
//! The poll-loop, name-normalization, cancellation, and session-timing logic is
//! exercised cross-platform with a fake [`ProcessTable`]; one Windows-gated test
//! spawns a real short-lived process and times it to exit via the real
//! ToolHelp/`OpenProcess` table.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;

use game_manager_lib::db::repo::{games, sessions};
use game_manager_lib::domain::MonitorMode;
use game_manager_lib::launch::cancel::CancelToken;
use game_manager_lib::monitor::named_process::{
    normalize_process_name, NamedProcessLauncher, NamedProcessMonitor, ProcessTable,
};
use game_manager_lib::monitor::{Monitor, StartOutcome};
use game_manager_lib::state::AppState;

// ----- normalization --------------------------------------------------------

#[test]
fn normalizes_bare_name_extension_and_path() {
    assert_eq!(normalize_process_name("Game"), "game.exe");
    assert_eq!(normalize_process_name("Game.exe"), "game.exe");
    assert_eq!(normalize_process_name("Game.EXE"), "game.exe");
    assert_eq!(normalize_process_name(r"C:\Games\Sub\Real.exe"), "real.exe");
    assert_eq!(normalize_process_name("C:/Games/Real.exe"), "real.exe");
    assert_eq!(normalize_process_name("  \"Quoted Game.exe\"  "), "quoted game.exe");
    assert_eq!(normalize_process_name(""), "");
    assert_eq!(normalize_process_name("   "), "");
}

// ----- fake process table ---------------------------------------------------

/// A fake table that returns a configured pid snapshot for each poll; later
/// polls keep returning the final snapshot. `wait_for_exit` resolves after a
/// short tick (or on cancel).
struct FakeTable {
    target: String,
    pid_snapshots: Vec<Vec<u32>>,
    polls: AtomicUsize,
    exit_after: Duration,
    saw_pid: std::sync::Mutex<Option<u32>>,
}

impl FakeTable {
    fn new(target: &str, pid_snapshots: Vec<Vec<u32>>, exit_after: Duration) -> Self {
        FakeTable {
            target: target.to_string(),
            pid_snapshots,
            polls: AtomicUsize::new(0),
            exit_after,
            saw_pid: std::sync::Mutex::new(None),
        }
    }
}

#[derive(Default)]
struct FakeLauncher {
    calls: std::sync::Mutex<Vec<(String, Option<String>)>>,
    fail: bool,
}

impl FakeLauncher {
    fn failing() -> Self {
        FakeLauncher {
            calls: std::sync::Mutex::new(Vec::new()),
            fail: true,
        }
    }
}

struct ArcLauncher(Arc<FakeLauncher>);

impl NamedProcessLauncher for ArcLauncher {
    fn launch(
        &self,
        launch_target: &str,
        arguments: Option<&str>,
    ) -> game_manager_lib::error::AppResult<()> {
        self.0.calls.lock().unwrap().push((
            launch_target.to_string(),
            arguments.map(str::to_string),
        ));
        if self.0.fail {
            return Err(game_manager_lib::error::AppError::other("launch failed"));
        }
        Ok(())
    }
}

#[async_trait]
impl ProcessTable for FakeTable {
    fn find_pids_by_name(&self, normalized_name: &str) -> game_manager_lib::error::AppResult<Vec<u32>> {
        assert_eq!(normalized_name, self.target, "monitor should query the normalized name");
        let index = self.polls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .pid_snapshots
            .get(index)
            .or_else(|| self.pid_snapshots.last())
            .cloned()
            .unwrap_or_default())
    }

    async fn wait_for_exit(&self, pid: u32, cancel: &CancelToken) -> game_manager_lib::error::AppResult<bool> {
        *self.saw_pid.lock().unwrap() = Some(pid);
        tokio::select! {
            _ = tokio::time::sleep(self.exit_after) => Ok(true),
            _ = cancel.cancelled() => Ok(false),
        }
    }
}

fn seed_named_game(
    state: &AppState,
    launch_target: &str,
    arguments: Option<&str>,
    process_name: &str,
) -> i64 {
    state
        .with_db(|conn| {
            games::create(
                conn,
                &games::NewGame {
                    name: "StoreGame".to_string(),
                    launch_target: launch_target.to_string(),
                    monitor_mode: MonitorMode::Named,
                    monitor_process_name: Some(process_name.to_string()),
                    arguments: arguments.map(str::to_string),
                    image_path: None,
                },
            )
        })
        .unwrap()
}

#[tokio::test]
async fn detects_named_process_and_writes_accurate_session() {
    let state = AppState::in_memory().unwrap();
    let game_id = seed_named_game(&state, "steam://run/123", Some("--flag value"), "Real.exe");

    let table = FakeTable::new("real.exe", vec![vec![], vec![], vec![4242]], Duration::from_millis(20));
    let monitor = NamedProcessMonitor::new(table, ArcLauncher(Arc::new(FakeLauncher::default())));
    let cancel = CancelToken::new();

    let outcome = monitor.wait_for_start(&state, game_id, &cancel).await.unwrap();
    let token = match outcome {
        StartOutcome::Started(token) => token,
        StartOutcome::Cancelled => panic!("expected detection"),
    };

    let elapsed = monitor.wait_for_end(&state, token, &cancel).await.unwrap();
    assert!(elapsed >= 0, "elapsed seconds must be non-negative");

    // A single session row was opened and closed.
    let sessions = state.with_db(|conn| sessions::list_for_game(conn, game_id)).unwrap();
    assert_eq!(sessions.len(), 1);
    assert!(sessions[0].ended_at.is_some(), "session must be closed");
}

#[tokio::test]
async fn cancellation_before_detection_opens_no_session() {
    let state = AppState::in_memory().unwrap();
    let game_id = seed_named_game(&state, "steam://run/never", None, "Never.exe");

    let table = FakeTable::new("never.exe", vec![vec![]], Duration::ZERO);
    let monitor = NamedProcessMonitor::new(table, ArcLauncher(Arc::new(FakeLauncher::default())));
    let cancel = CancelToken::new();
    cancel.cancel();

    let outcome = monitor.wait_for_start(&state, game_id, &cancel).await.unwrap();
    assert_eq!(outcome, StartOutcome::Cancelled);

    let sessions = state.with_db(|conn| sessions::list_for_game(conn, game_id)).unwrap();
    assert!(sessions.is_empty(), "no session on pre-detection cancel");
}

#[tokio::test]
async fn pre_cancel_does_not_launch_named_process_target() {
    let state = AppState::in_memory().unwrap();
    let game_id = seed_named_game(&state, "steam://run/never", Some("--offline"), "Never.exe");
    let launcher = Arc::new(FakeLauncher::default());
    let monitor = NamedProcessMonitor::new(
        FakeTable::new("never.exe", vec![vec![]], Duration::ZERO),
        ArcLauncher(launcher.clone()),
    );
    let cancel = CancelToken::new();
    cancel.cancel();

    let outcome = monitor.wait_for_start(&state, game_id, &cancel).await.unwrap();
    assert_eq!(outcome, StartOutcome::Cancelled);
    assert!(
        launcher.calls.lock().unwrap().is_empty(),
        "pre-cancelled named launches must not spawn the launcher target"
    );
}

#[tokio::test]
async fn ignores_pre_existing_matching_processes_and_waits_for_new_pid() {
    let state = AppState::in_memory().unwrap();
    let game_id = seed_named_game(&state, "steam://run/123", None, "Real.exe");

    let table = Arc::new(FakeTable::new(
        "real.exe",
        vec![vec![1111], vec![1111], vec![1111, 2222]],
        Duration::from_millis(10),
    ));
    let monitor = NamedProcessMonitor::new(
        ArcTable(table.clone()),
        ArcLauncher(Arc::new(FakeLauncher::default())),
    );
    let cancel = CancelToken::new();

    let token = match monitor.wait_for_start(&state, game_id, &cancel).await.unwrap() {
        StartOutcome::Started(token) => token,
        StartOutcome::Cancelled => panic!("expected detection"),
    };
    let _ = monitor.wait_for_end(&state, token, &cancel).await.unwrap();

    assert_eq!(*table.saw_pid.lock().unwrap(), Some(2222));
}

#[tokio::test]
async fn missing_process_name_errors() {
    let state = AppState::in_memory().unwrap();
    // monitor_mode Named requires a name at the DB layer, so seed Tree then a
    // bare game whose name is blank-after-normalization to exercise the guard.
    let game_id = seed_named_game(&state, "steam://run/123", None, "  \"\"  ");
    let table = FakeTable::new("", vec![vec![1]], Duration::ZERO);
    let monitor = NamedProcessMonitor::new(table, ArcLauncher(Arc::new(FakeLauncher::default())));
    let cancel = CancelToken::new();
    let result = monitor.wait_for_start(&state, game_id, &cancel).await;
    assert!(result.is_err(), "empty normalized name must error");
}

#[tokio::test]
async fn wait_for_end_threads_the_detected_pid() {
    let state = AppState::in_memory().unwrap();
    let game_id = seed_named_game(&state, "steam://run/123", None, "Real.exe");

    let table = Arc::new(FakeTable::new(
        "real.exe",
        vec![vec![], vec![7777]],
        Duration::from_millis(10),
    ));
    let monitor = NamedProcessMonitor::new(
        ArcTable(table.clone()),
        ArcLauncher(Arc::new(FakeLauncher::default())),
    );
    let cancel = CancelToken::new();

    let token = match monitor.wait_for_start(&state, game_id, &cancel).await.unwrap() {
        StartOutcome::Started(t) => t,
        StartOutcome::Cancelled => panic!("expected start"),
    };
    let _ = monitor.wait_for_end(&state, token, &cancel).await.unwrap();
    assert_eq!(*table.saw_pid.lock().unwrap(), Some(7777), "wait_for_end gets detected pid");
}

#[tokio::test]
async fn launches_configured_target_before_polling_process_name() {
    let state = AppState::in_memory().unwrap();
    let game_id = seed_named_game(
        &state,
        "steam://run/123",
        Some("--offline --windowed"),
        "Real.exe",
    );
    let launcher = Arc::new(FakeLauncher::default());
    let monitor = NamedProcessMonitor::new(
        FakeTable::new("real.exe", vec![vec![], vec![7777]], Duration::ZERO),
        ArcLauncher(launcher.clone()),
    );
    let cancel = CancelToken::new();

    let outcome = monitor.wait_for_start(&state, game_id, &cancel).await.unwrap();
    assert!(matches!(outcome, StartOutcome::Started(_)));
    assert_eq!(
        launcher.calls.lock().unwrap().as_slice(),
        &[("steam://run/123".to_string(), Some("--offline --windowed".to_string()))]
    );
}

#[tokio::test]
async fn launch_failure_propagates_without_opening_session() {
    let state = AppState::in_memory().unwrap();
    let game_id = seed_named_game(&state, "steam://run/bad", Some("--x"), "Bad.exe");
    let monitor = NamedProcessMonitor::new(
        FakeTable::new("bad.exe", vec![vec![5]], Duration::ZERO),
        ArcLauncher(Arc::new(FakeLauncher::failing())),
    );
    let cancel = CancelToken::new();

    let result = monitor.wait_for_start(&state, game_id, &cancel).await;
    assert!(result.is_err(), "launch failures must surface");

    let sessions = state.with_db(|conn| sessions::list_for_game(conn, game_id)).unwrap();
    assert!(sessions.is_empty(), "no session when the launch target fails");
}

/// Newtype so a shared `Arc<FakeTable>` can implement `ProcessTable`.
struct ArcTable(Arc<FakeTable>);

#[async_trait]
impl ProcessTable for ArcTable {
    fn find_pids_by_name(&self, n: &str) -> game_manager_lib::error::AppResult<Vec<u32>> {
        self.0.find_pids_by_name(n)
    }
    async fn wait_for_exit(&self, pid: u32, cancel: &CancelToken) -> game_manager_lib::error::AppResult<bool> {
        self.0.wait_for_exit(pid, cancel).await
    }
}

// ----- Windows-gated real-process test --------------------------------------

#[cfg(windows)]
#[tokio::test]
async fn windows_times_a_real_named_process() {
    use game_manager_lib::monitor::named_process::windows_monitor;

    let state = AppState::in_memory().unwrap();
    let game_id = seed_named_game(&state, "ping.exe", Some("-n 2 127.0.0.1"), "ping.exe");

    let monitor = windows_monitor();
    let cancel = CancelToken::new();

    // The monitor must launch `ping.exe` itself, then detect that named process.
    let token = match monitor.wait_for_start(&state, game_id, &cancel).await.unwrap() {
        StartOutcome::Started(t) => t,
        StartOutcome::Cancelled => panic!("expected to detect ping.exe"),
    };

    // `ping -n 2` exits quickly on its own, so wait_for_end should complete
    // without manual teardown.
    let elapsed = monitor.wait_for_end(&state, token, &cancel).await.unwrap();
    assert!(elapsed >= 0);

    let sessions = state.with_db(|conn| sessions::list_for_game(conn, game_id)).unwrap();
    assert_eq!(sessions.len(), 1);
    assert!(sessions[0].ended_at.is_some());
}
