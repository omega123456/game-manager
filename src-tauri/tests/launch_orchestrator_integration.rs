//! Orchestrator integration tests: full launch lifecycle against the stub
//! monitor — phase sequencing + events, session writing, per-script logging,
//! failure-logged-and-continue, and cancellation.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use game_manager_lib::commands::launch::run_launch_impl;
use game_manager_lib::db::repo::{games, launch_runs, scripts, sessions};
use game_manager_lib::domain::{
    Interpreter, LaunchPhase, LaunchRunStatus, LogLevel, MonitorMode, PhaseConfig, PhaseMode,
    ScriptExecutionStatus, ScriptKind,
};
use game_manager_lib::launch::cancel::CancelToken;
use game_manager_lib::launch::events::{
    EventSink, LaunchLifecycle, ScriptExecutionUpdated, EVENT_ENDED, EVENT_ERROR, EVENT_PHASE,
};
use game_manager_lib::monitor::stub::StubMonitor;
use game_manager_lib::monitor::Monitor;
use game_manager_lib::state::AppState;

/// In-memory event recorder used in place of the Tauri `AppHandle` sink.
#[derive(Default, Clone)]
struct Recorder {
    events: Arc<Mutex<Vec<(String, LaunchLifecycle)>>>,
    script_events: Arc<Mutex<Vec<(String, ScriptExecutionUpdated)>>>,
}

impl EventSink for Recorder {
    fn emit_lifecycle(&self, event: &str, payload: &LaunchLifecycle) {
        self.events
            .lock()
            .unwrap()
            .push((event.to_string(), payload.clone()));
    }

    fn emit_script_execution_updated(&self, event: &str, payload: &ScriptExecutionUpdated) {
        self.script_events
            .lock()
            .unwrap()
            .push((event.to_string(), payload.clone()));
    }
}

impl Recorder {
    fn phases(&self) -> Vec<LaunchPhase> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter(|(name, _)| name == EVENT_PHASE)
            .map(|(_, payload)| payload.phase)
            .collect()
    }

    fn names(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .map(|(name, _)| name.clone())
            .collect()
    }

    fn ended_phase(&self) -> Option<LaunchPhase> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|(name, _)| name == EVENT_ENDED)
            .map(|(_, payload)| payload.phase)
    }

    fn final_failed_count(&self) -> u32 {
        self.events
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|(name, _)| name == EVENT_ENDED)
            .map(|(_, payload)| payload.failed_count)
            .unwrap_or(0)
    }

    fn script_event_count(&self) -> usize {
        self.script_events.lock().unwrap().len()
    }
}

#[derive(Debug, Clone)]
struct ScriptEventSnapshot {
    payload: ScriptExecutionUpdated,
    run_status: LaunchRunStatus,
    record_statuses: Vec<ScriptExecutionStatus>,
}

#[derive(Clone)]
struct InspectingRecorder {
    state: Arc<AppState>,
    snapshots: Arc<Mutex<Vec<ScriptEventSnapshot>>>,
}

impl InspectingRecorder {
    fn new(state: Arc<AppState>) -> Self {
        Self {
            state,
            snapshots: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn snapshots(&self) -> Vec<ScriptEventSnapshot> {
        self.snapshots.lock().unwrap().clone()
    }
}

impl EventSink for InspectingRecorder {
    fn emit_lifecycle(&self, _event: &str, _payload: &LaunchLifecycle) {}

    fn emit_script_execution_updated(&self, _event: &str, payload: &ScriptExecutionUpdated) {
        let run = self
            .state
            .with_db(|conn| launch_runs::get_run(conn, payload.launch_run_id))
            .expect("ledger write must be committed before update event");
        self.snapshots.lock().unwrap().push(ScriptEventSnapshot {
            payload: payload.clone(),
            run_status: run.status,
            record_statuses: run
                .script_records
                .into_iter()
                .map(|record| record.status)
                .collect(),
        });
    }
}

fn none() -> PhaseConfig {
    PhaseConfig::default()
}

fn inline(code: &str) -> PhaseConfig {
    PhaseConfig {
        mode: PhaseMode::Inline,
        path: None,
        inline: Some(code.to_string()),
        interpreter: Some(Interpreter::Powershell),
    }
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

fn normal(
    name: &str,
    before: PhaseConfig,
    after: PhaseConfig,
    on_exit: PhaseConfig,
) -> scripts::NewScript {
    scripts::NewScript {
        name: name.to_string(),
        description: None,
        kind: ScriptKind::Normal,
        priority: 5,
        before_launch: before,
        after_launch: after,
        on_exit: on_exit,
        snippet: none(),
    }
}

fn state() -> AppState {
    AppState::in_memory().unwrap()
}

#[tokio::test]
async fn runs_all_phases_emits_full_sequence_and_writes_session() {
    let state = state();
    let game_id = state
        .with_db(|conn| games::create(conn, &new_game("Phased")))
        .unwrap();

    let script_id = state
        .with_db(|conn| {
            scripts::create(
                conn,
                &normal(
                    "Tri",
                    inline("Write-Output 'before'"),
                    inline("Write-Output 'after'"),
                    inline("Write-Output 'onexit'"),
                ),
            )
        })
        .unwrap();
    state
        .with_db(|conn| games::set_scripts(conn, game_id, &[script_id]))
        .unwrap();

    let recorder = Recorder::default();
    let monitor: Arc<dyn Monitor> = Arc::new(StubMonitor::immediate());
    let cancel = CancelToken::new();

    let failed = run_launch_impl(&state, game_id, monitor, &recorder, cancel)
        .await
        .unwrap();
    assert_eq!(failed, 0);

    // The lifecycle visits each phase in order on the phase channel; the Ended
    // phase arrives on the dedicated ended channel.
    let phases = recorder.phases();
    let order = [
        LaunchPhase::Before,
        LaunchPhase::WaitingForProcess,
        LaunchPhase::Playing,
        LaunchPhase::OnExit,
    ];
    let mut cursor = 0;
    for phase in order {
        assert!(
            phases[cursor..].contains(&phase),
            "missing {phase:?} after index {cursor} in {phases:?}"
        );
        cursor = phases.iter().position(|p| *p == phase).unwrap() + 1;
    }
    assert!(
        recorder.ended_phase().is_some(),
        "an ended event must be emitted"
    );

    // An ended event was emitted exactly once.
    assert_eq!(
        recorder
            .names()
            .iter()
            .filter(|n| *n == EVENT_ENDED)
            .count(),
        1
    );

    // A session row was written and closed.
    let sessions = state
        .with_db(|conn| sessions::list_for_game(conn, game_id))
        .unwrap();
    assert_eq!(sessions.len(), 1);
    assert!(sessions[0].ended_at.is_some());
    let last_played = state
        .with_db(|conn| game_manager_lib::db::repo::settings::get(conn, "last_played_game_id"))
        .unwrap();
    assert_eq!(last_played, Some(game_id.to_string()));

    // Each phase's script result was logged.
    let logs = state
        .with_db(|conn| game_manager_lib::db::repo::logs::list_recent(conn, 100))
        .unwrap();
    let ran_logs = logs
        .iter()
        .filter(|l| l.message.contains("'Tri' ran"))
        .count();
    assert_eq!(ran_logs, 3, "expected one ran-log per phase");

    let latest_run = state
        .with_db(|conn| launch_runs::get_latest_run_for_game(conn, game_id))
        .unwrap()
        .expect("latest run");
    assert_eq!(latest_run.status, LaunchRunStatus::Completed);
    assert_eq!(latest_run.play_session_id, Some(sessions[0].id));
    assert_eq!(
        latest_run
            .script_records
            .iter()
            .map(|record| record.status)
            .collect::<Vec<_>>(),
        vec![
            ScriptExecutionStatus::Succeeded,
            ScriptExecutionStatus::Succeeded,
            ScriptExecutionStatus::Succeeded
        ]
    );
    assert!(latest_run
        .script_records
        .iter()
        .all(|record| record.started_at.is_some() && record.ended_at.is_some()));
    assert!(recorder.script_event_count() >= 8);
}

#[tokio::test]
async fn normal_script_calls_required_utility_function() {
    let state = state();
    let game_id = state
        .with_db(|conn| games::create(conn, &new_game("UtilGame")))
        .unwrap();

    let util_id = state
        .with_db(|conn| {
            scripts::create(
                conn,
                &scripts::NewScript {
                    name: "GreetLib".to_string(),
                    description: None,
                    kind: ScriptKind::Utility,
                    priority: 5,
                    before_launch: none(),
                    after_launch: none(),
                    on_exit: none(),
                    snippet: inline("function Get-Greeting { 'hi-util' }"),
                },
            )
        })
        .unwrap();

    let script_id = state
        .with_db(|conn| {
            scripts::create(
                conn,
                &normal(
                    "Greeter",
                    inline("Write-Output (Get-Greeting)"),
                    none(),
                    none(),
                ),
            )
        })
        .unwrap();
    state
        .with_db(|conn| scripts::set_dependencies(conn, script_id, &[util_id]))
        .unwrap();
    state
        .with_db(|conn| games::set_scripts(conn, game_id, &[script_id]))
        .unwrap();

    let recorder = Recorder::default();
    let monitor: Arc<dyn Monitor> = Arc::new(StubMonitor::immediate());
    run_launch_impl(&state, game_id, monitor, &recorder, CancelToken::new())
        .await
        .unwrap();

    let logs = state
        .with_db(|conn| game_manager_lib::db::repo::logs::list_recent(conn, 100))
        .unwrap();
    let detail_has_util = logs
        .iter()
        .any(|l| l.details.as_deref().is_some_and(|d| d.contains("hi-util")));
    assert!(
        detail_has_util,
        "utility function output should be captured in logs"
    );
}

#[tokio::test]
async fn failing_script_does_not_halt_pipeline() {
    let state = state();
    let game_id = state
        .with_db(|conn| games::create(conn, &new_game("FailGame")))
        .unwrap();

    // A failing before-script + a succeeding on-exit script.
    let failing = state
        .with_db(|conn| scripts::create(conn, &normal("Boom", inline("exit 7"), none(), none())))
        .unwrap();
    let cleanup = state
        .with_db(|conn| {
            scripts::create(
                conn,
                &normal("Cleanup", none(), none(), inline("Write-Output 'cleaned'")),
            )
        })
        .unwrap();
    state
        .with_db(|conn| games::set_scripts(conn, game_id, &[failing, cleanup]))
        .unwrap();

    let recorder = Recorder::default();
    let monitor: Arc<dyn Monitor> = Arc::new(StubMonitor::immediate());
    let failed = run_launch_impl(&state, game_id, monitor, &recorder, CancelToken::new())
        .await
        .unwrap();

    assert_eq!(failed, 1, "one script failed");
    assert_eq!(recorder.final_failed_count(), 1);
    // The pipeline still reached the end and ran cleanup.
    assert_eq!(recorder.ended_phase(), Some(LaunchPhase::Ended));
    assert!(recorder.names().iter().any(|n| n == EVENT_ERROR));

    let logs = state
        .with_db(|conn| game_manager_lib::db::repo::logs::list_recent(conn, 100))
        .unwrap();
    assert!(logs.iter().any(|l| l.message.contains("'Cleanup' ran")));
    assert!(logs
        .iter()
        .any(|l| l.level == LogLevel::Error && l.message.contains("'Boom' failed")));

    let latest_run = state
        .with_db(|conn| launch_runs::get_latest_run_for_game(conn, game_id))
        .unwrap()
        .expect("latest run");
    assert_eq!(latest_run.status, LaunchRunStatus::Completed);
    assert_eq!(latest_run.failure_count, 1);
    assert_eq!(
        latest_run
            .script_records
            .iter()
            .map(|record| record.status)
            .collect::<Vec<_>>(),
        vec![
            ScriptExecutionStatus::Failed,
            ScriptExecutionStatus::Succeeded
        ]
    );
}

#[tokio::test]
async fn cancel_before_start_aborts_without_session() {
    let state = state();
    let game_id = state
        .with_db(|conn| games::create(conn, &new_game("CancelEarly")))
        .unwrap();

    // A monitor that would wait a long time for start; cancel pre-empts it.
    let monitor: Arc<dyn Monitor> = Arc::new(StubMonitor::with_delays(
        Duration::from_secs(30),
        Duration::ZERO,
    ));
    let cancel = CancelToken::new();
    cancel.cancel();

    let recorder = Recorder::default();
    run_launch_impl(&state, game_id, monitor, &recorder, cancel)
        .await
        .unwrap();

    // No session opened; ended emitted with a cancel detail.
    let sessions = state
        .with_db(|conn| sessions::list_for_game(conn, game_id))
        .unwrap();
    assert!(
        sessions.is_empty(),
        "cancel before start must not open a session"
    );
    let last_played = state
        .with_db(|conn| game_manager_lib::db::repo::settings::get(conn, "last_played_game_id"))
        .unwrap();
    assert_eq!(
        last_played, None,
        "pre-start cancellation must not update Play Now"
    );
    let ended = recorder
        .events
        .lock()
        .unwrap()
        .iter()
        .rev()
        .find(|(n, _)| n == EVENT_ENDED)
        .map(|(_, p)| p.clone())
        .unwrap();
    assert_eq!(ended.detail.as_deref(), Some("cancelled"));

    let latest_run = state
        .with_db(|conn| launch_runs::get_latest_run_for_game(conn, game_id))
        .unwrap()
        .expect("latest run");
    assert_eq!(latest_run.status, LaunchRunStatus::Cancelled);
    assert!(latest_run.play_session_id.is_none());
    assert!(latest_run
        .script_records
        .iter()
        .all(|record| record.status == ScriptExecutionStatus::NotReached));
}

#[tokio::test]
async fn cancel_aborts_a_pending_end_wait_quickly() {
    let state = state();
    let game_id = state
        .with_db(|conn| games::create(conn, &new_game("CancelWait")))
        .unwrap();

    // Immediate start, but a very long end wait that cancel must interrupt.
    let monitor: Arc<dyn Monitor> = Arc::new(StubMonitor::with_delays(
        Duration::ZERO,
        Duration::from_secs(30),
    ));
    let cancel = CancelToken::new();
    let recorder = Recorder::default();

    let task_state = &state;
    let cancel_for_task = cancel.clone();
    let run = run_launch_impl(task_state, game_id, monitor, &recorder, cancel);

    // Cancel shortly after the run begins; the end-wait should unblock at once.
    let canceller = async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        cancel_for_task.cancel();
    };

    let (failed, _) = tokio::join!(run, canceller);
    let failed = failed.unwrap();
    assert_eq!(failed, 0);

    // Session was still closed despite the cancel, and ended within the test
    // budget (far under the 30s monitor delay).
    let sessions = state
        .with_db(|conn| sessions::list_for_game(conn, game_id))
        .unwrap();
    assert_eq!(sessions.len(), 1);
    assert!(sessions[0].ended_at.is_some());

    let latest_run = state
        .with_db(|conn| launch_runs::get_latest_run_for_game(conn, game_id))
        .unwrap()
        .expect("latest run");
    assert_eq!(latest_run.status, LaunchRunStatus::Cancelled);
}

#[tokio::test]
async fn script_completion_events_are_emitted_after_committed_ledger_updates() {
    let state = Arc::new(state());
    let game_id = state
        .with_db(|conn| games::create(conn, &new_game("CommittedEvents")))
        .unwrap();
    let before_script = state
        .with_db(|conn| {
            scripts::create(
                conn,
                &normal(
                    "Before One",
                    inline("Write-Output 'before'"),
                    none(),
                    none(),
                ),
            )
        })
        .unwrap();
    let after_script = state
        .with_db(|conn| {
            scripts::create(
                conn,
                &normal("After One", none(), inline("Write-Output 'after'"), none()),
            )
        })
        .unwrap();
    state
        .with_db(|conn| games::set_scripts(conn, game_id, &[before_script, after_script]))
        .unwrap();

    let recorder = InspectingRecorder::new(state.clone());
    let monitor: Arc<dyn Monitor> = Arc::new(StubMonitor::immediate());
    run_launch_impl(
        state.as_ref(),
        game_id,
        monitor,
        &recorder,
        CancelToken::new(),
    )
    .await
    .unwrap();

    let snapshots = recorder.snapshots();
    assert!(snapshots
        .iter()
        .any(|snapshot| snapshot.payload.game_id == game_id
            && snapshot
                .record_statuses
                .contains(&ScriptExecutionStatus::Running)));
    assert!(snapshots
        .iter()
        .any(|snapshot| snapshot.run_status == LaunchRunStatus::Completed
            && snapshot
                .record_statuses
                .iter()
                .filter(|status| **status == ScriptExecutionStatus::Succeeded)
                .count()
                >= 2));
    assert!(snapshots
        .iter()
        .all(|snapshot| snapshot.payload.launch_run_id > 0));
    assert!(snapshots
        .iter()
        .all(|snapshot| snapshot.payload.game_id == game_id));
    assert!(
        snapshots.len() >= 6,
        "expected seed, running, and completion events"
    );
    assert!(
        snapshots
            .iter()
            .filter(|snapshot| snapshot.run_status == LaunchRunStatus::Completed)
            .count()
            >= 1
    );
}

#[tokio::test]
async fn same_script_enabled_in_multiple_phases_updates_each_ledger_row_independently() {
    let state = state();
    let game_id = state
        .with_db(|conn| games::create(conn, &new_game("MultiPhaseScript")))
        .unwrap();

    let script_id = state
        .with_db(|conn| {
            scripts::create(
                conn,
                &normal(
                    "Reuse Me",
                    inline("Write-Output 'before-ok'"),
                    inline("exit 7"),
                    none(),
                ),
            )
        })
        .unwrap();
    state
        .with_db(|conn| games::set_scripts(conn, game_id, &[script_id]))
        .unwrap();

    let recorder = Recorder::default();
    let monitor: Arc<dyn Monitor> = Arc::new(StubMonitor::immediate());
    let failed = run_launch_impl(&state, game_id, monitor, &recorder, CancelToken::new())
        .await
        .unwrap();

    assert_eq!(failed, 1);

    let latest_run = state
        .with_db(|conn| launch_runs::get_latest_run_for_game(conn, game_id))
        .unwrap()
        .expect("latest run");
    assert_eq!(latest_run.status, LaunchRunStatus::Completed);
    assert_eq!(latest_run.failure_count, 1);
    assert_eq!(
        latest_run.script_records.len(),
        2,
        "one row per enabled phase should be seeded"
    );

    let before = latest_run
        .script_records
        .iter()
        .find(|record| record.phase == game_manager_lib::domain::ScriptPhase::Before)
        .expect("before row");
    assert_eq!(before.script_id, Some(script_id));
    assert_eq!(before.status, ScriptExecutionStatus::Succeeded);
    assert!(before.started_at.is_some());
    assert!(before.ended_at.is_some());

    let after = latest_run
        .script_records
        .iter()
        .find(|record| record.phase == game_manager_lib::domain::ScriptPhase::After)
        .expect("after row");
    assert_eq!(after.script_id, Some(script_id));
    assert_eq!(after.status, ScriptExecutionStatus::Failed);
    assert!(after.started_at.is_some());
    assert!(after.ended_at.is_some());
}
