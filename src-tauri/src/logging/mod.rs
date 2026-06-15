//! Application logging: tracing init + the `logs`-table facade.
//!
//! A single entrypoint [`write_log`] persists a structured row to the `logs`
//! table AND mirrors it to `tracing`. [`run_retention`] prunes rows older than
//! seven days and reclaims space via `PRAGMA incremental_vacuum`; it is invoked
//! on startup and once daily. The frontend reaches this facade through the
//! `log_frontend` command (see `crate::commands::logging`).

use std::sync::Once;

use chrono::{Duration, Utc};
use rusqlite::Connection;
use tracing_subscriber::EnvFilter;

use crate::db::repo::logs::{self, NewLog};
use crate::domain::LogLevel;
use crate::error::AppResult;

static INIT: Once = Once::new();

/// Number of days of logs to retain before pruning.
pub const RETENTION_DAYS: i64 = 7;

/// Initialize the global `tracing` subscriber exactly once.
///
/// Idempotent: safe to call from both the app entrypoint and tests. The log
/// level is read from `RUST_LOG`, defaulting to `info`.
pub fn init_tracing() {
    INIT.call_once(|| {
        let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
        let _ = tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_target(false)
            .try_init();
    });
}

/// Mirror a log line to the `tracing` subscriber at the matching level.
fn mirror_to_tracing(level: LogLevel, category: &str, message: &str) {
    match level {
        LogLevel::Debug => tracing::debug!(category, "{message}"),
        LogLevel::Info => tracing::info!(category, "{message}"),
        LogLevel::Warn => tracing::warn!(category, "{message}"),
        LogLevel::Error => tracing::error!(category, "{message}"),
    }
}

/// Persist a structured log row and mirror it to `tracing`.
///
/// Returns the new row's id. This is the single entrypoint for application
/// logging that must reach the `logs` table.
pub fn write_log(
    conn: &Connection,
    level: LogLevel,
    category: &str,
    message: &str,
    game_id: Option<i64>,
    script_id: Option<i64>,
    details: Option<&str>,
) -> AppResult<i64> {
    mirror_to_tracing(level, category, message);
    let entry = NewLog {
        ts: Utc::now().to_rfc3339(),
        level,
        category: category.to_string(),
        message: message.to_string(),
        game_id,
        script_id,
        details: details.map(str::to_string),
    };
    logs::insert(conn, &entry)
}

/// Delete log rows older than the retention window and reclaim space.
///
/// Removes rows whose `ts` precedes `now - RETENTION_DAYS`, then runs
/// `PRAGMA incremental_vacuum` to return freed pages. Returns the number of rows
/// pruned. Invoked on startup and once daily.
pub fn run_retention(conn: &Connection) -> AppResult<usize> {
    let cutoff = (Utc::now() - Duration::days(RETENTION_DAYS)).to_rfc3339();
    let removed = logs::delete_older_than(conn, &cutoff)?;
    // Reclaim pages freed by the delete. Harmless when nothing was freed.
    conn.execute_batch("PRAGMA incremental_vacuum;")?;
    if removed > 0 {
        tracing::info!(category = "logging", "pruned {removed} expired log rows");
    }
    Ok(removed)
}
