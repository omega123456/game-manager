//! Logging command (`log_frontend`): impl + thin wrapper.
//!
//! The frontend (`src/lib/app-log-commands.ts`) routes all logging here. The
//! `*_impl` is testable without the Tauri runtime; the `#[tauri::command]`
//! wrapper is registered in `lib.rs` and granted via `permissions/logging.toml`
//! + `capabilities/default.json`.

use crate::domain::LogLevel;
use crate::error::AppResult;
use crate::logging::write_log;
use crate::state::AppState;

/// Map a frontend level string to a [`LogLevel`].
///
/// The frontend stub permits `trace`, which the `logs` table does not model;
/// it is folded into `debug`. Unknown values default to `info`.
fn parse_level(level: &str) -> LogLevel {
    match level {
        "error" => LogLevel::Error,
        "warn" => LogLevel::Warn,
        "info" => LogLevel::Info,
        "debug" | "trace" => LogLevel::Debug,
        _ => LogLevel::Info,
    }
}

/// Persist a frontend log line to the `logs` table (mirrored to `tracing`).
///
/// Returns the new row's id. `category` defaults to `frontend` when absent.
pub fn log_frontend_impl(
    state: &AppState,
    level: &str,
    category: Option<&str>,
    message: &str,
    details: Option<&str>,
) -> AppResult<i64> {
    let level = parse_level(level);
    let category = category.unwrap_or("frontend");
    state.with_db(|conn| write_log(conn, level, category, message, None, None, details))
}

/// Thin `#[tauri::command]` wrapper delegating to [`log_frontend_impl`].
///
/// Pure Tauri-runtime glue with no logic of its own (everything is in
/// [`log_frontend_impl`], which is unit-tested). Like the `run()` entrypoint it
/// cannot be exercised headlessly, so it is excluded from coverage
/// instrumentation under `--cfg coverage` — the same sanctioned runtime-boundary
/// exclusion established in Phase A1.
#[cfg(not(coverage))]
#[tauri::command]
pub fn log_frontend(
    state: tauri::State<'_, AppState>,
    level: String,
    category: Option<String>,
    message: String,
    details: Option<String>,
) -> AppResult<i64> {
    log_frontend_impl(
        &state,
        &level,
        category.as_deref(),
        &message,
        details.as_deref(),
    )
}
