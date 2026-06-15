//! Play-sessions repository.
//!
//! Helpers to start, end, and read `play_sessions` rows. The monitor writes
//! sessions in later phases; this module provides the storage primitives.

use rusqlite::{params, Connection, Row};

use crate::domain::PlaySession;
use crate::error::{AppError, AppResult};

fn map_session(row: &Row<'_>) -> rusqlite::Result<PlaySession> {
    Ok(PlaySession {
        id: row.get("id")?,
        game_id: row.get("game_id")?,
        started_at: row.get("started_at")?,
        ended_at: row.get("ended_at")?,
    })
}

/// Start a session for a game (open-ended) and return its id.
pub fn start(conn: &Connection, game_id: i64) -> AppResult<i64> {
    let started_at = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO play_sessions (game_id, started_at, ended_at) VALUES (?1, ?2, NULL)",
        params![game_id, started_at],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Mark a session ended at `now`. Returns whether a row changed.
pub fn end(conn: &Connection, session_id: i64) -> AppResult<bool> {
    let ended_at = chrono::Utc::now().to_rfc3339();
    let changed = conn.execute(
        "UPDATE play_sessions SET ended_at = ?2 WHERE id = ?1",
        params![session_id, ended_at],
    )?;
    Ok(changed > 0)
}

/// Insert a fully-specified session (used by tests / backfills). Returns its id.
pub fn insert(
    conn: &Connection,
    game_id: i64,
    started_at: &str,
    ended_at: Option<&str>,
) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO play_sessions (game_id, started_at, ended_at) VALUES (?1, ?2, ?3)",
        params![game_id, started_at, ended_at],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Fetch a single session by id.
pub fn get(conn: &Connection, id: i64) -> AppResult<PlaySession> {
    let mut stmt =
        conn.prepare("SELECT id, game_id, started_at, ended_at FROM play_sessions WHERE id = ?1")?;
    let mut rows = stmt.query_map(params![id], map_session)?;
    match rows.next() {
        Some(row) => Ok(row?),
        None => Err(AppError::database(format!("session {id} not found"))),
    }
}

/// List all sessions for a game, most recent first.
pub fn list_for_game(conn: &Connection, game_id: i64) -> AppResult<Vec<PlaySession>> {
    let mut stmt = conn.prepare(
        "SELECT id, game_id, started_at, ended_at FROM play_sessions
         WHERE game_id = ?1 ORDER BY started_at DESC",
    )?;
    super::collect_rows(&mut stmt, params![game_id], map_session)
}
