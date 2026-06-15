//! Launch command + AppState launch-registry integration tests: the cancel
//! command surface and the registry that targets an in-flight launch.

use std::sync::Arc;

use game_manager_lib::commands::launch::{cancel_launch_impl, prepare_launch_impl, run_launch_impl};
use game_manager_lib::db::repo::games;
use game_manager_lib::domain::MonitorMode;
use game_manager_lib::launch::cancel::CancelToken;
use game_manager_lib::launch::events::{EventSink, LaunchLifecycle};
use game_manager_lib::monitor::stub::{elapsed_seconds, StubMonitor};
use game_manager_lib::monitor::{Monitor, StartOutcome};
use game_manager_lib::state::AppState;

struct NoopSink;
impl EventSink for NoopSink {
    fn emit(&self, _event: &str, _payload: &LaunchLifecycle) {}
}

fn new_game(name: &str) -> games::NewGame {
    games::NewGame {
        name: name.to_string(),
        launch_target: format!("C:/Games/{name}.exe"),
        monitor_mode: MonitorMode::Tree,
        monitor_process_name: None,
        arguments: None,
        image_path: None,
    }
}

#[test]
fn cancel_launch_returns_false_when_no_launch_active() {
    let state = AppState::in_memory().unwrap();
    assert!(!cancel_launch_impl(&state, 42).unwrap());
}

#[test]
fn register_then_cancel_targets_the_running_launch() {
    let state = AppState::in_memory().unwrap();
    let token = state.register_launch(7).unwrap();
    assert!(!token.is_cancelled());

    // The registered launch can be cancelled by id.
    assert!(cancel_launch_impl(&state, 7).unwrap());
    assert!(token.is_cancelled());

    // After unregister, cancel reports no active launch.
    state.unregister_launch(7);
    assert!(!cancel_launch_impl(&state, 7).unwrap());
}

#[tokio::test]
async fn cancel_launch_command_aborts_an_in_flight_run() {
    let state = AppState::in_memory().unwrap();
    let game_id = state.with_db(|conn| games::create(conn, &new_game("CmdCancel"))).unwrap();

    // Register the token the orchestrator will observe, mirroring the wrapper.
    let token = state.register_launch(game_id).unwrap();
    // Cancel before start so the run ends immediately without a session.
    assert!(cancel_launch_impl(&state, game_id).unwrap());

    let monitor: Arc<dyn Monitor> =
        Arc::new(StubMonitor::with_delays(std::time::Duration::from_secs(30), std::time::Duration::ZERO));
    let failed = run_launch_impl(&state, game_id, monitor, &NoopSink, token)
        .await
        .unwrap();
    assert_eq!(failed, 0);
    // run_launch_impl unregisters the launch on completion.
    assert!(!cancel_launch_impl(&state, game_id).unwrap());
}

#[test]
fn register_launch_rejects_overlapping_launches() {
    let state = AppState::in_memory().unwrap();
    let _first = state.register_launch(7).unwrap();

    let duplicate = state.register_launch(7).err().unwrap().to_string();
    assert!(duplicate.contains("already launching"));

    let other_game = state.register_launch(8).err().unwrap().to_string();
    assert!(other_game.contains("already launching"));
}

#[test]
fn prepare_launch_cleans_up_registry_when_monitor_selection_fails() {
    let state = AppState::in_memory().unwrap();

    let err = prepare_launch_impl(&state, 9999).err().unwrap().to_string();
    assert!(err.contains("game 9999 not found"));

    let token = state.register_launch(7).unwrap();
    assert!(!token.is_cancelled(), "registry should be clear after failed prepare");
}

#[tokio::test]
async fn cancel_token_unblocks_waiting_task() {
    let token = CancelToken::new();
    let waiter = token.clone();
    let handle = tokio::spawn(async move {
        waiter.cancelled().await;
    });
    tokio::task::yield_now().await;
    token.cancel();
    handle.await.expect("waiter task should finish");
}

#[tokio::test]
async fn cancel_token_returns_immediately_when_already_cancelled() {
    let token = CancelToken::new();
    token.cancel();
    tokio::time::timeout(std::time::Duration::from_millis(50), token.cancelled())
        .await
        .expect("already-cancelled token must not hang");
}

#[tokio::test]
async fn stub_monitor_respects_cancellation_during_start_delay() {
    let state = AppState::in_memory().unwrap();
    let game_id = state
        .with_db(|conn| games::create(conn, &new_game("StubCancel")))
        .unwrap();
    let monitor: Arc<dyn Monitor> = Arc::new(StubMonitor::with_delays(
        std::time::Duration::from_millis(500),
        std::time::Duration::ZERO,
    ));
    let cancel = CancelToken::new();
    let cancel_handle = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        cancel_handle.cancel();
    });
    let outcome = monitor.wait_for_start(&state, game_id, &cancel).await.unwrap();
    assert_eq!(outcome, StartOutcome::Cancelled);
}

#[tokio::test]
async fn stub_monitor_records_session_after_end_delay() {
    let state = AppState::in_memory().unwrap();
    let game_id = state
        .with_db(|conn| games::create(conn, &new_game("StubEnd")))
        .unwrap();
    let monitor: Arc<dyn Monitor> = Arc::new(StubMonitor::with_delays(
        std::time::Duration::ZERO,
        std::time::Duration::from_millis(15),
    ));
    let cancel = CancelToken::new();
    let StartOutcome::Started(session_id) = monitor.wait_for_start(&state, game_id, &cancel).await.unwrap()
    else {
        panic!("expected a started session");
    };
    let elapsed = monitor.wait_for_end(&state, session_id, &cancel).await.unwrap();
    assert!(elapsed >= 0);
}

#[cfg(windows)]
#[test]
fn prepare_launch_returns_monitor_for_existing_game() {
    let state = AppState::in_memory().unwrap();
    let game_id = state
        .with_db(|conn| games::create(conn, &new_game("PrepOk")))
        .unwrap();
    let (token, _monitor) = prepare_launch_impl(&state, game_id).unwrap();
    assert!(!token.is_cancelled());
    state.unregister_launch(game_id);
}

#[test]
fn cancel_launch_returns_false_when_launch_registry_mutex_poisoned() {
    let state = AppState::in_memory().unwrap();
    let _token = state.register_launch(1).unwrap();
    state.poison_launches_mutex_for_test();
    assert!(!cancel_launch_impl(&state, 1).unwrap());
}

#[test]
fn unregister_launch_noops_when_launch_registry_mutex_poisoned() {
    let state = AppState::in_memory().unwrap();
    let _token = state.register_launch(3).unwrap();
    state.poison_launches_mutex_for_test();
    state.unregister_launch(3);
    state.poison_launches_mutex_for_test();
}

#[test]
fn elapsed_seconds_handles_missing_and_unparseable_timestamps() {
    assert_eq!(elapsed_seconds("2026-01-01T00:00:00Z", None), 0);
    assert_eq!(elapsed_seconds("not-a-time", Some("2026-01-01T00:00:05Z")), 0);
    assert_eq!(
        elapsed_seconds("2026-01-01T00:00:00Z", Some("2026-01-01T00:00:05Z")),
        5
    );
    // End before start clamps to 0.
    assert_eq!(
        elapsed_seconds("2026-01-01T00:00:05Z", Some("2026-01-01T00:00:00Z")),
        0
    );
}
