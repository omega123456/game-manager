//! DLSS detection-cache repository.
//!
//! Read/write helpers over the `game_dlss_state` table: the optional install
//! folder override plus the cached results of the last folder scan. Presets are
//! NOT stored here (they live in the NVIDIA driver DB and are read live via
//! NVAPI). The cached row is keyed by game id.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::{DetectedDll, GameDlssState};
use crate::error::AppResult;

/// Map a `game_dlss_state` row into a [`GameDlssState`].
///
/// The `stale` flag defaults to `false` on read; callers compute staleness from
/// `last_scanned_at` policy and detection logic (Phase 2).
fn map_state(row: &Row<'_>) -> rusqlite::Result<GameDlssState> {
    let sr_version: Option<String> = row.get("detected_sr_version")?;
    let sr_path: Option<String> = row.get("detected_sr_path")?;
    let fg_version: Option<String> = row.get("detected_fg_version")?;
    let fg_path: Option<String> = row.get("detected_fg_path")?;
    let rr_version: Option<String> = row.get("detected_rr_version")?;
    let rr_path: Option<String> = row.get("detected_rr_path")?;
    Ok(GameDlssState {
        game_id: row.get("game_id")?,
        folder_override: row.get("folder_override")?,
        folder_resolved: None,
        super_resolution: detected(sr_version, sr_path),
        frame_generation: detected(fg_version, fg_path),
        ray_reconstruction: detected(rr_version, rr_path),
        last_scanned_at: row.get("last_scanned_at")?,
        stale: false,
    })
}

/// Build a [`DetectedDll`] when both the version and path are present.
fn detected(version: Option<String>, path: Option<String>) -> Option<DetectedDll> {
    match (version, path) {
        (Some(version), Some(path)) => Some(DetectedDll {
            version,
            path,
            md5: None,
        }),
        _ => None,
    }
}

/// Fetch the cached DLSS state for `game_id`, or `None` if no row exists yet.
pub fn get(conn: &Connection, game_id: i64) -> AppResult<Option<GameDlssState>> {
    let mut stmt = conn.prepare(
        "SELECT game_id, folder_override,
                detected_sr_version, detected_fg_version, detected_rr_version,
                detected_sr_path, detected_fg_path, detected_rr_path,
                last_scanned_at
         FROM game_dlss_state WHERE game_id = ?1",
    )?;
    let state = stmt.query_row(params![game_id], map_state).optional()?;
    Ok(state)
}

/// List every cached DLSS state (drives library pills), ordered by game id.
pub fn list(conn: &Connection) -> AppResult<Vec<GameDlssState>> {
    let mut stmt = conn.prepare(
        "SELECT game_id, folder_override,
                detected_sr_version, detected_fg_version, detected_rr_version,
                detected_sr_path, detected_fg_path, detected_rr_path,
                last_scanned_at
         FROM game_dlss_state ORDER BY game_id",
    )?;
    super::collect_rows(&mut stmt, [], map_state)
}

/// Upsert the full cached state for a game (folder override + detection + scan
/// time). `folder_resolved` and `stale` are runtime-only and not persisted.
pub fn upsert(conn: &Connection, state: &GameDlssState) -> AppResult<()> {
    let (sr_version, sr_path) = split(&state.super_resolution);
    let (fg_version, fg_path) = split(&state.frame_generation);
    let (rr_version, rr_path) = split(&state.ray_reconstruction);
    conn.execute(
        "INSERT INTO game_dlss_state (
            game_id, folder_override,
            detected_sr_version, detected_fg_version, detected_rr_version,
            detected_sr_path, detected_fg_path, detected_rr_path,
            last_scanned_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(game_id) DO UPDATE SET
            folder_override = excluded.folder_override,
            detected_sr_version = excluded.detected_sr_version,
            detected_fg_version = excluded.detected_fg_version,
            detected_rr_version = excluded.detected_rr_version,
            detected_sr_path = excluded.detected_sr_path,
            detected_fg_path = excluded.detected_fg_path,
            detected_rr_path = excluded.detected_rr_path,
            last_scanned_at = excluded.last_scanned_at",
        params![
            state.game_id,
            state.folder_override,
            sr_version,
            fg_version,
            rr_version,
            sr_path,
            fg_path,
            rr_path,
            state.last_scanned_at,
        ],
    )?;
    Ok(())
}

/// Set (or clear, with `None`) only the folder override for a game, preserving
/// any cached detection. Inserts a row when none exists yet.
pub fn set_folder_override(
    conn: &Connection,
    game_id: i64,
    folder: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO game_dlss_state (game_id, folder_override)
         VALUES (?1, ?2)
         ON CONFLICT(game_id) DO UPDATE SET folder_override = excluded.folder_override",
        params![game_id, folder],
    )?;
    Ok(())
}

/// Decompose a detected DLL into its `(version, path)` columns.
fn split(detected: &Option<DetectedDll>) -> (Option<&str>, Option<&str>) {
    match detected {
        Some(dll) => (Some(dll.version.as_str()), Some(dll.path.as_str())),
        None => (None, None),
    }
}
