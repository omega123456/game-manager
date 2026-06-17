//! Logs repository.
//!
//! Storage primitives for the `logs` table. The structured facade and retention
//! routine in `crate::logging` build on these helpers.

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, Row};

use crate::domain::{LogEntry, LogLevel};
use crate::error::AppResult;

/// A new log row to insert.
#[derive(Debug, Clone)]
pub struct NewLog {
    /// Timestamp (RFC 3339).
    pub ts: String,
    /// Severity level.
    pub level: LogLevel,
    /// Category (free-form domain tag).
    pub category: String,
    /// Log message.
    pub message: String,
    /// Optional associated game id.
    pub game_id: Option<i64>,
    /// Optional associated script id.
    pub script_id: Option<i64>,
    /// Optional structured details.
    pub details: Option<String>,
}

fn map_log(row: &Row<'_>) -> rusqlite::Result<LogEntry> {
    let level_raw: String = row.get("level")?;
    let level = LogLevel::from_db_str(&level_raw).ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(0, "level".into(), rusqlite::types::Type::Text)
    })?;
    Ok(LogEntry {
        id: row.get("id")?,
        ts: row.get("ts")?,
        level,
        category: row.get("category")?,
        message: row.get("message")?,
        game_id: row.get("game_id")?,
        script_id: row.get("script_id")?,
        details: row.get("details")?,
    })
}

/// Insert a log row and return its assigned id.
pub fn insert(conn: &Connection, entry: &NewLog) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO logs (ts, level, category, message, game_id, script_id, details)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            entry.ts,
            entry.level.as_db_str(),
            entry.category,
            entry.message,
            entry.game_id,
            entry.script_id,
            entry.details,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Delete all log rows with `ts` strictly older than `cutoff` (RFC 3339).
/// Returns the number of rows removed.
pub fn delete_older_than(conn: &Connection, cutoff: &str) -> AppResult<usize> {
    let removed = conn.execute("DELETE FROM logs WHERE ts < ?1", params![cutoff])?;
    Ok(removed)
}

/// Fetch a single log row by id.
pub fn get(conn: &Connection, id: i64) -> AppResult<Option<LogEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, ts, level, category, message, game_id, script_id, details
         FROM logs WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], map_log)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// List the most recent `limit` log rows, newest first.
pub fn list_recent(conn: &Connection, limit: i64) -> AppResult<Vec<LogEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, ts, level, category, message, game_id, script_id, details
         FROM logs ORDER BY ts DESC, id DESC LIMIT ?1",
    )?;
    super::collect_rows(&mut stmt, params![limit], map_log)
}

/// Count all log rows.
pub fn count(conn: &Connection) -> AppResult<i64> {
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM logs", [], |row| row.get(0))?;
    Ok(total)
}

/// Optional filters for the Log Viewer: an exact severity level and a free-text
/// term matched against the message or category (case-insensitive `LIKE`).
#[derive(Debug, Clone, Copy, Default)]
pub struct LogFilter<'a> {
    /// Exact severity level (DB string, e.g. `"error"`); `None` matches all.
    pub level: Option<&'a str>,
    /// Substring matched against `message` or `category`; `None`/empty matches all.
    pub search: Option<&'a str>,
}

/// Build the dynamic `WHERE` clause and its positional params for a filter.
///
/// `since` (RFC 3339) additionally restricts rows to `ts >= since` and is used to
/// size the recent-day pagination window. Empty filter fields are ignored.
fn build_where(filter: &LogFilter<'_>, since: Option<&str>) -> (String, Vec<Value>) {
    let mut clauses: Vec<&str> = Vec::new();
    let mut params: Vec<Value> = Vec::new();
    if let Some(level) = filter.level.filter(|s| !s.is_empty()) {
        clauses.push("level = ?");
        params.push(Value::Text(level.to_string()));
    }
    if let Some(term) = filter.search.map(str::trim).filter(|s| !s.is_empty()) {
        clauses.push("(message LIKE ? OR category LIKE ?)");
        let like = format!("%{term}%");
        params.push(Value::Text(like.clone()));
        params.push(Value::Text(like));
    }
    if let Some(since) = since {
        clauses.push("ts >= ?");
        params.push(Value::Text(since.to_string()));
    }
    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };
    (where_sql, params)
}

/// Count log rows matching `filter`, optionally restricted to `ts >= since`.
pub fn count_filtered(
    conn: &Connection,
    filter: &LogFilter<'_>,
    since: Option<&str>,
) -> AppResult<i64> {
    let (where_sql, params) = build_where(filter, since);
    let sql = format!("SELECT COUNT(*) FROM logs{where_sql}");
    let total: i64 = conn.query_row(&sql, params_from_iter(params.iter()), |row| row.get(0))?;
    Ok(total)
}

/// List a page of log rows matching `filter`, newest first, skipping `offset`.
pub fn list_filtered_page(
    conn: &Connection,
    filter: &LogFilter<'_>,
    limit: i64,
    offset: i64,
) -> AppResult<Vec<LogEntry>> {
    let (where_sql, mut params) = build_where(filter, None);
    params.push(Value::Integer(limit));
    params.push(Value::Integer(offset));
    let sql = format!(
        "SELECT id, ts, level, category, message, game_id, script_id, details
         FROM logs{where_sql} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?"
    );
    let mut stmt = conn.prepare(&sql)?;
    super::collect_rows(&mut stmt, params_from_iter(params.iter()), map_log)
}
