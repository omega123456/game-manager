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

use crate::domain::{LaunchPhase, LogLevel, ResolvedScript, Script, ScriptPhase};
use crate::error::AppResult;
use crate::launch::cancel::CancelToken;
use crate::launch::events::{EventSink, LaunchLifecycle, EVENT_ENDED, EVENT_ERROR, EVENT_PHASE};
use crate::launch::{executor, resolver};
use crate::logging;
use crate::monitor::{Monitor, StartOutcome};
use crate::state::AppState;

/// Tracks cumulative failure count + a stable game id across the run.
struct Lifecycle<'a> {
    game_id: i64,
    failed_count: u32,
    sink: &'a dyn EventSink,
}

impl Lifecycle<'_> {
    fn emit_phase(&self, phase: LaunchPhase, detail: Option<String>, elapsed: Option<i64>) {
        self.sink.emit(
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
        self.sink.emit(
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
        self.sink.emit(
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
) -> AppResult<u32> {
    let resolved = state.with_db(|conn| resolver::resolve_for_game(conn, game_id))?;
    let scripts_by_id = state.with_db(|conn| {
        let all = crate::db::repo::scripts::list(conn)?;
        Ok(all.into_iter().map(|s| (s.id, s)).collect::<HashMap<_, _>>())
    })?;

    let mut lifecycle = Lifecycle {
        game_id,
        failed_count: 0,
        sink,
    };

    log_via_state(state, LogLevel::Info, game_id, None, "launch started");

    // Phase 1 — Before Launch.
    lifecycle.emit_phase(LaunchPhase::Before, None, None);
    run_phase_logged(state, &mut lifecycle, LaunchPhase::Before, &resolved, &scripts_by_id).await;

    // Phase 2 — wait for the process to appear.
    lifecycle.emit_phase(LaunchPhase::WaitingForProcess, None, None);
    let start = monitor.wait_for_start(state, game_id, &cancel).await?;
    let session_id = match start {
        StartOutcome::Started(id) => id,
        StartOutcome::Cancelled => {
            log_via_state(state, LogLevel::Warn, game_id, None, "launch cancelled before start");
            lifecycle.emit_ended(Some("cancelled".to_string()), None);
            return Ok(lifecycle.failed_count);
        }
    };
    state.with_db(|conn| {
        crate::db::repo::settings::set(conn, "last_played_game_id", &game_id.to_string())
    })?;

    // Phase 3 — playing; run the After-Process-Detected scripts.
    lifecycle.emit_phase(LaunchPhase::Playing, None, Some(0));
    run_phase_logged(state, &mut lifecycle, LaunchPhase::Playing, &resolved, &scripts_by_id).await;

    // Wait for the process to exit (or cancellation), closing the session.
    let elapsed = monitor.wait_for_end(state, session_id, &cancel).await?;

    // Phase 4 — On Exit cleanup (always runs, even on cancel — best-effort).
    lifecycle.emit_phase(LaunchPhase::OnExit, None, Some(elapsed));
    run_phase_logged(state, &mut lifecycle, LaunchPhase::OnExit, &resolved, &scripts_by_id).await;

    // Done.
    let ended_detail = if cancel.is_cancelled() {
        Some("cancelled".to_string())
    } else {
        None
    };
    log_via_state(
        state,
        LogLevel::Info,
        game_id,
        None,
        &format!("launch ended ({elapsed}s, {} failed)", lifecycle.failed_count),
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
    let total = entries.len();

    for (index, entry) in entries.into_iter().enumerate() {
        lifecycle.emit_phase(launch_phase, Some(format!("{}/{}", index + 1, total)), None);

        let Some(script) = scripts_by_id.get(&entry.script_id) else {
            continue;
        };
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
                lifecycle.emit_error(
                    launch_phase,
                    execution
                        .detail
                        .clone()
                        .unwrap_or_else(|| format!("script '{}' failed", entry.name)),
                );
            }
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
        logging::write_log(conn, level, "launch", message, Some(game_id), script_id, None)
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
