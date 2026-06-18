//! DLSS folder-override repository.
//!
//! Read/write helpers over the `game_dlss_state` table. The only durable
//! per-game DLSS datum is the optional install-folder override; DLL detection
//! results are session-only and held in [`crate::state::AppState`]'s in-memory
//! cache, never persisted here. Presets are NOT stored here either — they live
//! in the NVIDIA driver DB and are read live via NVAPI. The row is keyed by
//! game id.

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppResult;

/// Fetch the folder override for `game_id`, or `None` when unset / no row exists.
pub fn get_folder_override(conn: &Connection, game_id: i64) -> AppResult<Option<String>> {
    let mut stmt =
        conn.prepare("SELECT folder_override FROM game_dlss_state WHERE game_id = ?1")?;
    let folder = stmt
        .query_row(params![game_id], |row| row.get::<_, Option<String>>(0))
        .optional()?
        .flatten();
    Ok(folder)
}

/// List every game id that has a stored folder override, with its value.
pub fn list_folder_overrides(conn: &Connection) -> AppResult<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT game_id, folder_override FROM game_dlss_state
         WHERE folder_override IS NOT NULL ORDER BY game_id",
    )?;
    super::collect_rows(&mut stmt, [], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })
}

/// Set (or clear, with `None`) the folder override for a game. Inserts a row when
/// none exists yet.
pub fn set_folder_override(conn: &Connection, game_id: i64, folder: Option<&str>) -> AppResult<()> {
    conn.execute(
        "INSERT INTO game_dlss_state (game_id, folder_override)
         VALUES (?1, ?2)
         ON CONFLICT(game_id) DO UPDATE SET folder_override = excluded.folder_override",
        params![game_id, folder],
    )?;
    Ok(())
}
