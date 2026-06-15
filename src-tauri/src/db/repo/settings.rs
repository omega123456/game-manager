//! Settings repository.
//!
//! A simple key/value store backing API keys, theme, accent, and the
//! last-played game id.

use rusqlite::{params, Connection};

use crate::error::AppResult;

/// Fetch a single setting value, or `None` if unset.
pub fn get(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query_map(params![key], |row| row.get::<_, Option<String>>(0))?;
    match rows.next() {
        Some(row) => Ok(row?),
        None => Ok(None),
    }
}

/// Upsert a setting value.
pub fn set(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Fetch all settings as `(key, value)` pairs ordered by key.
pub fn get_all(conn: &Connection) -> AppResult<Vec<(String, Option<String>)>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
    super::collect_rows(&mut stmt, [], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    })
}
