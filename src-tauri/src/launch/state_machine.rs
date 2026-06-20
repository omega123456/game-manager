//! Launch state machine.
//!
//! Drives a game through the lifecycle:
//!
//! ```text
//! Before Launch → (wait for start) → After Process Detected
//!   → (wait for end) → On Exit → ended
//! ```
//!
//! At each transition it emits a [`LaunchLifecycle`] on the appropriate
//! `launch://*` channel. Script execution is **best-effort**: every phase result
//! is logged via the logging facade and a failure increments `failed_count` and
//! emits a `launch://error`, but the pipeline never halts. Cancellation (via the
//! shared [`CancelToken`]) aborts the wait-for-start/-end and skips the game's
//! own After phase, while still recording the session end and running On-Exit
//! cleanup.

use std::collections::HashMap;
use std::sync::Arc;

use crate::db::repo::launch_runs;
use crate::domain::{
    LaunchPhase, LaunchRunStatus, LaunchScriptRecord, LogLevel, ResolvedScript, Script,
    ScriptExecutionStatus, ScriptPhase,
};
use crate::error::AppResult;
use crate::launch::cancel::CancelToken;
use crate::launch::events::{
    EventSink, LaunchLifecycle, ScriptExecutionUpdated, EVENT_ENDED, EVENT_ERROR, EVENT_PHASE,
    EVENT_SCRIPT_EXECUTION_UPDATED,
};
use crate::launch::{executor, resolver};
use crate::logging;
use crate::monitor::{Monitor, StartOutcome};
use crate::state::AppState;

/// Tracks cumulative failure count + a stable game id across the run.
struct Lifecycle<'a> {
    game_id: i64,
    run_id: i64,
    failed_count: u32,
    sink: &'a dyn EventSink,
}

impl Lifecycle<'_> {
    fn emit_phase(&self, phase: LaunchPhase, detail: Option<String>, elapsed: Option<i64>) {
        self.sink.emit_lifecycle(
            EVENT_PHASE,
            &LaunchLifecycle {
                game_id: self.game_id,
                phase,
                detail,
                failed_count: self.failed_count,
                elapsed_seconds: elapsed,
            },
        );
    }

    fn emit_error(&self, phase: LaunchPhase, detail: String) {
        self.sink.emit_lifecycle(
            EVENT_ERROR,
            &LaunchLifecycle {
                game_id: self.game_id,
                phase,
                detail: Some(detail),
                failed_count: self.failed_count,
                elapsed_seconds: None,
            },
        );
    }

    fn emit_ended(&self, detail: Option<String>, elapsed: Option<i64>) {
        self.sink.emit_lifecycle(
            EVENT_ENDED,
            &LaunchLifecycle {
                game_id: self.game_id,
                phase: LaunchPhase::Ended,
                detail,
                failed_count: self.failed_count,
                elapsed_seconds: elapsed,
            },
        );
    }

    fn emit_script_execution_updated(&self) {
        self.sink.emit_script_execution_updated(
            EVENT_SCRIPT_EXECUTION_UPDATED,
            &ScriptExecutionUpdated {
                game_id: self.game_id,
                launch_run_id: self.run_id,
            },
        );
    }
}

/// Map a lifecycle launch phase onto the executable script phase.
fn script_phase_for(launch_phase: LaunchPhase) -> Option<ScriptPhase> {
    match launch_phase {
        LaunchPhase::Before => Some(ScriptPhase::Before),
        LaunchPhase::Playing => Some(ScriptPhase::After),
        LaunchPhase::OnExit => Some(ScriptPhase::OnExit),
        _ => None,
    }
}

/// Concatenate stdout/stderr into an optional details blob for logging.
fn build_log_details(stdout: &str, stderr: &str) -> Option<String> {
    let mut parts = Vec::new();
    if !stdout.trim().is_empty() {
        parts.push(format!("stdout: {}", stdout.trim()));
    }
    if !stderr.trim().is_empty() {
        parts.push(format!("stderr: {}", stderr.trim()));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

fn phase_label(phase: ScriptPhase) -> &'static str {
    match phase {
        ScriptPhase::Before => "before launch",
        ScriptPhase::After => "after process detected",
        ScriptPhase::OnExit => "on exit",
    }
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn mark_run_status(
    state: &AppState,
    lifecycle: &Lifecycle<'_>,
    status: LaunchRunStatus,
    ended_at: Option<&str>,
) {
    let failure_count = i64::from(lifecycle.failed_count);
    let updated = state.with_db(|conn| {
        launch_runs::set_run_status(conn, lifecycle.run_id, status, failure_count, ended_at)
    });
    match updated {
        Ok(true) => lifecycle.emit_script_execution_updated(),
        Ok(false) => tracing::warn!(
            category = "launch",
            game_id = lifecycle.game_id,
            run_id = lifecycle.run_id,
            "launch run missing during status update"
        ),
        Err(err) => tracing::warn!(
            category = "launch",
            game_id = lifecycle.game_id,
            run_id = lifecycle.run_id,
            "failed to update launch run status: {err}"
        ),
    }
}

fn link_play_session(state: &AppState, lifecycle: &Lifecycle<'_>, play_session_id: i64) {
    let linked = state
        .with_db(|conn| launch_runs::link_play_session(conn, lifecycle.run_id, play_session_id));
    match linked {
        Ok(true) => lifecycle.emit_script_execution_updated(),
        Ok(false) => tracing::warn!(
            category = "launch",
            game_id = lifecycle.game_id,
            run_id = lifecycle.run_id,
            play_session_id,
            "launch run missing during play-session link"
        ),
        Err(err) => tracing::warn!(
            category = "launch",
            game_id = lifecycle.game_id,
            run_id = lifecycle.run_id,
            play_session_id,
            "failed to link play session to launch run: {err}"
        ),
    }
}

fn update_script_record(
    state: &AppState,
    lifecycle: &Lifecycle<'_>,
    record_id: i64,
    status: ScriptExecutionStatus,
    started_at: Option<&str>,
    ended_at: Option<&str>,
    details: Option<&str>,
) {
    let updated = state.with_db(|conn| {
        launch_runs::update_script_record_status(
            conn, record_id, status, started_at, ended_at, details,
        )
    });
    match updated {
        Ok(true) => lifecycle.emit_script_execution_updated(),
        Ok(false) => tracing::warn!(
            category = "launch",
            game_id = lifecycle.game_id,
            run_id = lifecycle.run_id,
            record_id,
            "launch script record missing during status update"
        ),
        Err(err) => tracing::warn!(
            category = "launch",
            game_id = lifecycle.game_id,
            run_id = lifecycle.run_id,
            record_id,
            "failed to update launch script record: {err}"
        ),
    }
}

fn finalize_pending_records(state: &AppState, lifecycle: &Lifecycle<'_>, detail: &str) {
    let records = match state.with_db(|conn| launch_runs::get_run(conn, lifecycle.run_id)) {
        Ok(run) => run.script_records,
        Err(err) => {
            tracing::warn!(
                category = "launch",
                game_id = lifecycle.game_id,
                run_id = lifecycle.run_id,
                "failed to read launch script records for cancellation finalization: {err}"
            );
            return;
        }
    };
    let ended_at = now_rfc3339();
    for record in &records {
        if record.status == ScriptExecutionStatus::Pending {
            update_script_record(
                state,
                lifecycle,
                record.id,
                ScriptExecutionStatus::NotReached,
                None,
                Some(ended_at.as_str()),
                Some(detail),
            );
        }
    }
}

fn mark_pending_records_not_reached(state: &AppState, lifecycle: &Lifecycle<'_>) {
    finalize_pending_records(
        state,
        lifecycle,
        "launch cancelled before this script phase was reached",
    );
}

pub fn mark_pending_records_incomplete(state: &AppState, run_id: i64, game_id: i64) {
    let lifecycle = Lifecycle {
        game_id,
        run_id,
        failed_count: 0,
        sink: &crate::launch::events::NoopEventSink,
    };
    finalize_pending_records(
        state,
        &lifecycle,
        "launch ended before this script phase was reached",
    );
}

/// Run the full launch lifecycle for `game_id`.
///
/// `monitor` detects process start/end (the stub in Phase E1). `sink` receives
/// lifecycle events. `cancel` aborts the wait. Returns the number of failed
/// script results (best-effort; the function itself only errors on a hard
/// resolve/DB failure before execution begins).
pub async fn run_launch(
    state: &AppState,
    game_id: i64,
    monitor: Arc<dyn Monitor>,
    sink: &dyn EventSink,
    cancel: CancelToken,
    created_run_id: &std::sync::atomic::AtomicI64,
) -> AppResult<u32> {
    let resolved = state.with_db(|conn| resolver::resolve_for_game(conn, game_id))?;
    let scripts_by_id = state.with_db(|conn| {
        let all = crate::db::repo::scripts::list(conn)?;
        Ok(all
            .into_iter()
            .map(|s| (s.id, s))
            .collect::<HashMap<_, _>>())
    })?;
    let run_id = state.with_db(|conn| {
        let run = launch_runs::create_run(conn, game_id)?;
        let _ = launch_runs::seed_script_records(conn, run.id, &resolved)?;
        let _ = launch_runs::cleanup_old_runs_for_game(conn, game_id, run.id)?;
        Ok(run.id)
    })?;
    // Publish the run id THIS attempt created so the wrapper's hard-failure
    // finalizer only ever touches this run, never a stale leftover run.
    created_run_id.store(run_id, std::sync::atomic::Ordering::SeqCst);

    let mut lifecycle = Lifecycle {
        game_id,
        run_id,
        failed_count: 0,
        sink,
    };
    lifecycle.emit_script_execution_updated();

    log_via_state(state, LogLevel::Info, game_id, None, "launch started");

    // Phase 1 — Before Launch.
    lifecycle.emit_phase(LaunchPhase::Before, None, None);
    run_phase_logged(
        state,
        &mut lifecycle,
        LaunchPhase::Before,
        &resolved,
        &scripts_by_id,
    )
    .await;

    // Phase 2 — wait for the process to appear.
    lifecycle.emit_phase(LaunchPhase::WaitingForProcess, None, None);
    let start = monitor.wait_for_start(state, game_id, &cancel).await?;
    let session_id = match start {
        StartOutcome::Started(id) => {
            link_play_session(state, &lifecycle, id);
            id
        }
        StartOutcome::Cancelled => {
            mark_pending_records_not_reached(state, &lifecycle);
            let ended_at = now_rfc3339();
            mark_run_status(
                state,
                &lifecycle,
                LaunchRunStatus::Cancelled,
                Some(ended_at.as_str()),
            );
            log_via_state(
                state,
                LogLevel::Warn,
                game_id,
                None,
                "launch cancelled before start",
            );
            lifecycle.emit_ended(Some("cancelled".to_string()), None);
            return Ok(lifecycle.failed_count);
        }
    };
    state.with_db(|conn| {
        crate::db::repo::settings::set(conn, "last_played_game_id", &game_id.to_string())
    })?;

    // Phase 3 — playing; run the After-Process-Detected scripts.
    lifecycle.emit_phase(LaunchPhase::Playing, None, Some(0));
    run_phase_logged(
        state,
        &mut lifecycle,
        LaunchPhase::Playing,
        &resolved,
        &scripts_by_id,
    )
    .await;

    // Wait for the process to exit (or cancellation), closing the session.
    let elapsed = monitor.wait_for_end(state, session_id, &cancel).await?;

    // Phase 4 — On Exit cleanup (always runs, even on cancel — best-effort).
    lifecycle.emit_phase(LaunchPhase::OnExit, None, Some(elapsed));
    run_phase_logged(
        state,
        &mut lifecycle,
        LaunchPhase::OnExit,
        &resolved,
        &scripts_by_id,
    )
    .await;

    // Done.
    let ended_detail = if cancel.is_cancelled() {
        Some("cancelled".to_string())
    } else {
        None
    };
    let ended_at = now_rfc3339();
    let final_status = if cancel.is_cancelled() {
        LaunchRunStatus::Cancelled
    } else {
        LaunchRunStatus::Completed
    };
    mark_run_status(state, &lifecycle, final_status, Some(ended_at.as_str()));
    log_via_state(
        state,
        LogLevel::Info,
        game_id,
        None,
        &format!(
            "launch ended ({elapsed}s, {} failed)",
            lifecycle.failed_count
        ),
    );
    lifecycle.emit_ended(ended_detail, Some(elapsed));
    Ok(lifecycle.failed_count)
}

/// Run a phase, logging each script result through the DB connection.
async fn run_phase_logged(
    state: &AppState,
    lifecycle: &mut Lifecycle<'_>,
    launch_phase: LaunchPhase,
    resolved: &[ResolvedScript],
    scripts_by_id: &HashMap<i64, Script>,
) {
    let Some(script_phase) = script_phase_for(launch_phase) else {
        return;
    };
    let entries: Vec<&ResolvedScript> = resolved
        .iter()
        .filter(|entry| entry.phase == script_phase)
        .collect();
    let records_by_entry: HashMap<(i64, ScriptPhase), LaunchScriptRecord> =
        match state.with_db(|conn| {
            let run = launch_runs::get_run(conn, lifecycle.run_id)?;
            Ok(run
                .script_records
                .into_iter()
                .filter_map(|record| {
                    record
                        .script_id
                        .map(|script_id| ((script_id, record.phase), record))
                })
                .collect::<HashMap<_, _>>())
        }) {
            Ok(records) => records,
            Err(err) => {
                tracing::warn!(
                    category = "launch",
                    game_id = lifecycle.game_id,
                    run_id = lifecycle.run_id,
                    "failed to read launch script records for phase tracking: {err}"
                );
                HashMap::new()
            }
        };
    let total = entries.len();

    for (index, entry) in entries.into_iter().enumerate() {
        lifecycle.emit_phase(launch_phase, Some(format!("{}/{}", index + 1, total)), None);

        let Some(script) = scripts_by_id.get(&entry.script_id) else {
            continue;
        };
        let record = records_by_entry.get(&(entry.script_id, script_phase));
        let started_at = now_rfc3339();
        if let Some(record) = record {
            update_script_record(
                state,
                lifecycle,
                record.id,
                ScriptExecutionStatus::Running,
                Some(started_at.as_str()),
                None,
                None,
            );
        }
        let execution = executor::execute_phase(script, script_phase, scripts_by_id).await;

        for skipped in &execution.skipped_utilities {
            log_via_state_script(
                state,
                LogLevel::Warn,
                lifecycle.game_id,
                entry.script_id,
                &format!("skipped required utility '{skipped}' (interpreter mismatch)"),
                None,
            );
        }

        if execution.ran {
            let level = if execution.success {
                LogLevel::Info
            } else {
                LogLevel::Error
            };
            let detail = build_log_details(&execution.stdout, &execution.stderr);
            let ended_at = now_rfc3339();
            if let Some(record) = record {
                update_script_record(
                    state,
                    lifecycle,
                    record.id,
                    if execution.success {
                        ScriptExecutionStatus::Succeeded
                    } else {
                        ScriptExecutionStatus::Failed
                    },
                    Some(started_at.as_str()),
                    Some(ended_at.as_str()),
                    detail.as_deref().or(execution.detail.as_deref()),
                );
            }
            log_via_state_script(
                state,
                level,
                lifecycle.game_id,
                entry.script_id,
                &format!(
                    "script '{}' {} during {}",
                    entry.name,
                    if execution.success { "ran" } else { "failed" },
                    phase_label(script_phase)
                ),
                detail.as_deref(),
            );
            if !execution.success {
                lifecycle.failed_count += 1;
                mark_run_status(state, lifecycle, LaunchRunStatus::Active, None);
                lifecycle.emit_error(
                    launch_phase,
                    execution
                        .detail
                        .clone()
                        .unwrap_or_else(|| format!("script '{}' failed", entry.name)),
                );
            }
        } else if let Some(record) = record {
            let ended_at = now_rfc3339();
            update_script_record(
                state,
                lifecycle,
                record.id,
                ScriptExecutionStatus::Succeeded,
                Some(started_at.as_str()),
                Some(ended_at.as_str()),
                execution.detail.as_deref(),
            );
        }
    }
}

/// Write a log row tied to the game (best-effort; logging must never halt).
fn log_via_state(
    state: &AppState,
    level: LogLevel,
    game_id: i64,
    script_id: Option<i64>,
    message: &str,
) {
    let _ = state.with_db(|conn| {
        logging::write_log(
            conn,
            level,
            "launch",
            message,
            Some(game_id),
            script_id,
            None,
        )
    });
}

/// Write a script-scoped log row with optional details (best-effort).
fn log_via_state_script(
    state: &AppState,
    level: LogLevel,
    game_id: i64,
    script_id: i64,
    message: &str,
    details: Option<&str>,
) {
    let _ = state.with_db(|conn| {
        logging::write_log(
            conn,
            level,
            "launch",
            message,
            Some(game_id),
            Some(script_id),
            details,
        )
    });
}
