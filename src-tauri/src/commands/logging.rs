//! Logging command (`log_frontend`): impl + thin wrapper.
//!
//! The frontend (`src/lib/app-log-commands.ts`) routes all logging here. The
//! `*_impl` is testable without the Tauri runtime; the `#[tauri::command]`
//! wrapper is registered in `lib.rs` and granted via `permissions/logging.toml`
//! + `capabilities/default.json`.

use chrono::{Duration, Utc};

use crate::db::repo::logs::{self, LogFilter};
use crate::domain::{LogLevel, LogPage};
use crate::error::AppResult;
use crate::logging::{include_verbose_logs, write_log_with_minimum_level};
use crate::state::AppState;

/// Number of log rows shown per page in the Log Viewer.
pub const LOG_PAGE_SIZE: i64 = 25;

/// Minimum number of pages always made available, regardless of age. The viewer
/// pages over `max(LOG_PAGE_SIZE * LOG_MIN_PAGES, last 24h of logs)` rows,
/// capped by the actual row count.
pub const LOG_MIN_PAGES: i64 = 50;

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
/// Returns the new row's id, or `0` when the row is intentionally suppressed.
/// `category` defaults to `frontend` when absent.
pub fn log_frontend_impl_with_minimum_level(
    state: &AppState,
    level: &str,
    category: Option<&str>,
    message: &str,
    details: Option<&str>,
    include_verbose: bool,
) -> AppResult<i64> {
    let level = parse_level(level);
    let category = category.unwrap_or("frontend");
    state.with_db(|conn| {
        write_log_with_minimum_level(
            conn,
            level,
            category,
            message,
            None,
            None,
            details,
            include_verbose,
        )
    })
}

/// Persist a frontend log line using the current build's verbose-log visibility.
pub fn log_frontend_impl(
    state: &AppState,
    level: &str,
    category: Option<&str>,
    message: &str,
    details: Option<&str>,
) -> AppResult<i64> {
    log_frontend_impl_with_minimum_level(
        state,
        level,
        category,
        message,
        details,
        include_verbose_logs(cfg!(debug_assertions)),
    )
}

/// Fetch one page of log rows (newest first) for the Log Viewer.
///
/// `page` is 1-based (values below 1 are clamped to 1). Results can be narrowed
/// by an exact severity `level` and/or a free-text `search` term (matched
/// against the message or category). Pagination spans a bounded window of
/// `min(matching_rows, max(LOG_PAGE_SIZE * LOG_MIN_PAGES, matching_rows_in_last_24h))`
/// rows, so the viewer always exposes at least [`LOG_MIN_PAGES`] pages, or a full
/// day of logs when that is larger. The returned [`LogPage::total`] reflects that
/// bounded window. Pages beyond the window resolve to an empty `entries` list.
pub fn list_logs_impl_with_minimum_level(
    state: &AppState,
    page: i64,
    page_size: i64,
    level: Option<&str>,
    search: Option<&str>,
    include_verbose: bool,
) -> AppResult<LogPage> {
    let page = page.max(1);
    let page_size = page_size.max(1);
    let filter = LogFilter {
        level,
        search,
        include_verbose,
    };
    let day_cutoff = (Utc::now() - Duration::days(1)).to_rfc3339();
    state.with_db(|conn| {
        let actual_total = logs::count_filtered(conn, &filter, None)?;
        let day_count = logs::count_filtered(conn, &filter, Some(&day_cutoff))?;
        let bounded_total = actual_total.min((LOG_PAGE_SIZE * LOG_MIN_PAGES).max(day_count));

        let offset = (page - 1) * page_size;
        let remaining = (bounded_total - offset).max(0);
        let limit = remaining.min(page_size);
        let entries = if limit > 0 {
            logs::list_filtered_page(conn, &filter, limit, offset)?
        } else {
            Vec::new()
        };
        Ok(LogPage {
            entries,
            total: bounded_total,
            page,
            page_size,
        })
    })
}

/// Fetch one page of log rows using the current build's verbose-log visibility.
pub fn list_logs_impl(
    state: &AppState,
    page: i64,
    page_size: i64,
    level: Option<&str>,
    search: Option<&str>,
) -> AppResult<LogPage> {
    list_logs_impl_with_minimum_level(
        state,
        page,
        page_size,
        level,
        search,
        include_verbose_logs(cfg!(debug_assertions)),
    )
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

/// Thin `#[tauri::command]` wrapper delegating to [`list_logs_impl`].
///
/// Pure Tauri-runtime glue (logic lives in the unit-tested `*_impl`), so it is
/// excluded from coverage instrumentation under `--cfg coverage`, matching the
/// sanctioned runtime-boundary exclusion established in Phase A1. `page_size`
/// defaults to [`LOG_PAGE_SIZE`] when omitted by the caller.
#[cfg(not(coverage))]
#[tauri::command]
pub fn list_logs(
    state: tauri::State<'_, AppState>,
    page: i64,
    page_size: Option<i64>,
    level: Option<String>,
    search: Option<String>,
) -> AppResult<LogPage> {
    list_logs_impl(
        &state,
        page,
        page_size.unwrap_or(LOG_PAGE_SIZE),
        level.as_deref(),
        search.as_deref(),
    )
}
