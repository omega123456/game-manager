//! Launch command + AppState launch-registry integration tests: the cancel
//! command surface and the registry that targets an in-flight launch.

use std::sync::Arc;

use async_trait::async_trait;
use game_manager_lib::commands::launch::{
    cancel_launch_impl, prepare_launch_impl, run_launch_impl,
};
use game_manager_lib::db::repo::{games, launch_runs};
use game_manager_lib::domain::{LaunchRunStatus, MonitorMode};
use game_manager_lib::error::AppError;
use game_manager_lib::launch::cancel::CancelToken;
use game_manager_lib::launch::events::{EventSink, LaunchLifecycle, ScriptExecutionUpdated};
use game_manager_lib::monitor::stub::{elapsed_seconds, StubMonitor};
use game_manager_lib::monitor::{Monitor, StartOutcome};
use game_manager_lib::state::AppState;

struct NoopSink;
impl EventSink for NoopSink {
    fn emit_lifecycle(&self, _event: &str, _payload: &LaunchLifecycle) {}

    fn emit_script_execution_updated(&self, _event: &str, _payload: &ScriptExecutionUpdated) {}
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
    let game_id = state
        .with_db(|conn| games::create(conn, &new_game("CmdCancel")))
        .unwrap();

    // Register the token the orchestrator will observe, mirroring the wrapper.
    let token = state.register_launch(game_id).unwrap();
    // Cancel before start so the run ends immediately without a session.
    assert!(cancel_launch_impl(&state, game_id).unwrap());

    let monitor: Arc<dyn Monitor> = Arc::new(StubMonitor::with_delays(
        std::time::Duration::from_secs(30),
        std::time::Duration::ZERO,
    ));
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
    assert!(
        !token.is_cancelled(),
        "registry should be clear after failed prepare"
    );
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
    let outcome = monitor
        .wait_for_start(&state, game_id, &cancel)
        .await
        .unwrap();
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
    let StartOutcome::Started(session_id) = monitor
        .wait_for_start(&state, game_id, &cancel)
        .await
        .unwrap()
    else {
        panic!("expected a started session");
    };
    let elapsed = monitor
        .wait_for_end(&state, session_id, &cancel)
        .await
        .unwrap();
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
    assert_eq!(
        elapsed_seconds("not-a-time", Some("2026-01-01T00:00:05Z")),
        0
    );
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

struct FailingEndMonitor;

#[async_trait]
impl Monitor for FailingEndMonitor {
    async fn wait_for_start(
        &self,
        state: &AppState,
        game_id: i64,
        _cancel: &CancelToken,
    ) -> game_manager_lib::error::AppResult<StartOutcome> {
        let session_id =
            state.with_db(|conn| game_manager_lib::db::repo::sessions::start(conn, game_id))?;
        Ok(StartOutcome::Started(session_id))
    }

    async fn wait_for_end(
        &self,
        _state: &AppState,
        _session_id: i64,
        _cancel: &CancelToken,
    ) -> game_manager_lib::error::AppResult<i64> {
        Err(AppError::other("simulated monitor crash"))
    }
}

#[tokio::test]
async fn hard_failure_after_run_creation_marks_latest_run_incomplete() {
    let state = AppState::in_memory().unwrap();
    let game_id = state
        .with_db(|conn| games::create(conn, &new_game("IncompleteRun")))
        .unwrap();
    let before_script = state
        .with_db(|conn| {
            game_manager_lib::db::repo::scripts::create(
                conn,
                &game_manager_lib::db::repo::scripts::NewScript {
                    name: "Before Hook".to_string(),
                    description: None,
                    kind: game_manager_lib::domain::ScriptKind::Normal,
                    priority: 5,
                    before_launch: game_manager_lib::domain::PhaseConfig {
                        mode: game_manager_lib::domain::PhaseMode::Inline,
                        path: None,
                        inline: Some("Write-Output 'before'".to_string()),
                        interpreter: Some(game_manager_lib::domain::Interpreter::Powershell),
                    },
                    after_launch: game_manager_lib::domain::PhaseConfig::default(),
                    on_exit: game_manager_lib::domain::PhaseConfig::default(),
                    snippet: game_manager_lib::domain::PhaseConfig::default(),
                },
            )
        })
        .unwrap();
    let on_exit_script = state
        .with_db(|conn| {
            game_manager_lib::db::repo::scripts::create(
                conn,
                &game_manager_lib::db::repo::scripts::NewScript {
                    name: "Cleanup Hook".to_string(),
                    description: None,
                    kind: game_manager_lib::domain::ScriptKind::Normal,
                    priority: 5,
                    before_launch: game_manager_lib::domain::PhaseConfig::default(),
                    after_launch: game_manager_lib::domain::PhaseConfig::default(),
                    on_exit: game_manager_lib::domain::PhaseConfig {
                        mode: game_manager_lib::domain::PhaseMode::Inline,
                        path: None,
                        inline: Some("Write-Output 'cleanup'".to_string()),
                        interpreter: Some(game_manager_lib::domain::Interpreter::Powershell),
                    },
                    snippet: game_manager_lib::domain::PhaseConfig::default(),
                },
            )
        })
        .unwrap();
    state
        .with_db(|conn| {
            game_manager_lib::db::repo::games::set_scripts(
                conn,
                game_id,
                &[before_script, on_exit_script],
            )
        })
        .unwrap();

    let monitor: Arc<dyn Monitor> = Arc::new(FailingEndMonitor);
    let result = run_launch_impl(&state, game_id, monitor, &NoopSink, CancelToken::new()).await;
    let err = result.expect_err("monitor failure should bubble out");
    assert!(err.to_string().contains("simulated monitor crash"));

    let latest_run = state
        .with_db(|conn| launch_runs::get_latest_run_for_game(conn, game_id))
        .unwrap()
        .expect("latest run");
    assert_eq!(latest_run.status, LaunchRunStatus::Incomplete);
    assert!(latest_run.play_session_id.is_some());
    assert!(latest_run.ended_at.is_some());
    let before = latest_run
        .script_records
        .iter()
        .find(|record| record.name == "Before Hook")
        .expect("before hook row");
    assert_eq!(
        before.status,
        game_manager_lib::domain::ScriptExecutionStatus::Succeeded
    );
    assert!(before.started_at.is_some());
    assert!(before.ended_at.is_some());

    let cleanup = latest_run
        .script_records
        .iter()
        .find(|record| record.name == "Cleanup Hook")
        .expect("cleanup hook row");
    assert_eq!(
        cleanup.status,
        game_manager_lib::domain::ScriptExecutionStatus::NotReached
    );
    assert_eq!(
        cleanup.details.as_deref(),
        Some("launch ended before this script phase was reached")
    );
}

/// A launch attempt that fails BEFORE any run is created for it must not touch a
/// pre-existing, unrelated `Active` run for the same game (a stale leftover from
/// a prior crashed session). Regression for the bug where the hard-failure
/// finalizer grabbed the game's latest `Active` run and corrupted it.
#[tokio::test]
async fn hard_failure_before_run_creation_leaves_stale_active_run_untouched() {
    let state = AppState::in_memory().unwrap();
    let game_id = state
        .with_db(|conn| games::create(conn, &new_game("StaleActive")))
        .unwrap();

    // Simulate an orphaned, still-`Active` run left behind by a previous
    // app crash for THIS game.
    let stale_run_id = state
        .with_db(|conn| {
            let run = launch_runs::create_run(conn, game_id)?;
            Ok(run.id)
        })
        .unwrap();
    let stale_before = state
        .with_db(|conn| launch_runs::get_run(conn, stale_run_id))
        .unwrap();
    assert_eq!(stale_before.status, LaunchRunStatus::Active);
    assert!(stale_before.ended_at.is_none());

    // Force `resolve_for_game` to fail BEFORE `create_run` for THIS game by
    // wiring the game to a script id that does not exist (resolve errors with
    // "script ... not found during resolve"). This is the precise scenario the
    // bug mishandled: a hard failure for the same game that owns the stale run,
    // before this attempt creates any run of its own.
    state
        .with_db(|conn| {
            // Link the game to a script id, then remove that script row while
            // foreign keys are disabled so the dangling link survives. On the
            // next launch, resolve sees the link but cannot find the script.
            conn.execute("PRAGMA foreign_keys = OFF", [])?;
            conn.execute(
                "INSERT INTO game_scripts (game_id, script_id) VALUES (?1, ?2)",
                rusqlite::params![game_id, 999_999_i64],
            )?;
            conn.execute("PRAGMA foreign_keys = ON", [])?;
            Ok(())
        })
        .unwrap();

    let monitor: Arc<dyn Monitor> = Arc::new(StubMonitor::immediate());
    let result = run_launch_impl(&state, game_id, monitor, &NoopSink, CancelToken::new()).await;
    assert!(
        result.is_err(),
        "resolve failure must hard-fail before run creation"
    );

    // No new run was created for the failed attempt — the stale run is still the
    // only (and latest) run for the game.
    let latest = state
        .with_db(|conn| launch_runs::get_latest_run_for_game(conn, game_id))
        .unwrap()
        .expect("stale run is still latest");
    assert_eq!(latest.id, stale_run_id);

    // The stale run must be byte-for-byte unchanged: still Active, still open.
    let stale_after = state
        .with_db(|conn| launch_runs::get_run(conn, stale_run_id))
        .unwrap();
    assert_eq!(
        stale_after.status,
        LaunchRunStatus::Active,
        "stale run must NOT be marked Incomplete by an unrelated failed launch"
    );
    assert!(
        stale_after.ended_at.is_none(),
        "stale run must not be finalized"
    );
}
