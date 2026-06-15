//! Games repository.
//!
//! Read/write helpers returning [`Game`] domain structs, including computed
//! playtime aggregates derived from `play_sessions`. No Tauri command handlers
//! live here — those land in Phase B1.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::{Game, MonitorMode};
use crate::error::{AppError, AppResult};

/// Fields required to create a game.
#[derive(Debug, Clone)]
pub struct NewGame {
    /// Display name.
    pub name: String,
    /// Launch target (exe / shortcut / uri).
    pub launch_target: String,
    /// Process-monitoring mode.
    pub monitor_mode: MonitorMode,
    /// Real process name (required for `MonitorMode::Named`).
    pub monitor_process_name: Option<String>,
    /// Launch arguments.
    pub arguments: Option<String>,
    /// Cover-art image path.
    pub image_path: Option<String>,
}

/// Map a joined games row (with aggregates) into a [`Game`].
fn map_game(row: &Row<'_>) -> rusqlite::Result<Game> {
    let monitor_mode_raw: String = row.get("monitor_mode")?;
    let monitor_mode = MonitorMode::from_db_str(&monitor_mode_raw).ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(0, "monitor_mode".into(), rusqlite::types::Type::Text)
    })?;
    Ok(Game {
        id: row.get("id")?,
        name: row.get("name")?,
        launch_target: row.get("launch_target")?,
        monitor_mode,
        monitor_process_name: row.get("monitor_process_name")?,
        arguments: row.get("arguments")?,
        image_path: row.get("image_path")?,
        group_ids: parse_group_ids(row.get("group_ids")?),
        script_ids: parse_group_ids(row.get("script_ids")?),
        created_at: row.get("created_at")?,
        total_playtime_seconds: row.get("total_playtime_seconds")?,
        last_played_at: row.get("last_played_at")?,
    })
}

fn parse_group_ids(raw: Option<String>) -> Vec<i64> {
    raw.unwrap_or_default()
        .split(',')
        .filter_map(|value| value.trim().parse::<i64>().ok())
        .collect()
}

/// The SELECT body shared by list/get, computing aggregates from play_sessions.
const SELECT_GAMES: &str = "
SELECT
  g.id,
  g.name,
  g.launch_target,
  g.monitor_mode,
  g.monitor_process_name,
  g.arguments,
  g.image_path,
  (
    SELECT group_concat(gg.group_id)
    FROM (
      SELECT group_id
      FROM game_groups
      WHERE game_id = g.id
      ORDER BY group_id
    ) gg
  ) AS group_ids,
  (
    SELECT group_concat(gs.script_id)
    FROM (
      SELECT script_id
      FROM game_scripts
      WHERE game_id = g.id
      ORDER BY script_id
    ) gs
  ) AS script_ids,
  g.created_at,
  COALESCE(SUM(
    CASE WHEN s.ended_at IS NOT NULL
      THEN MAX(0, CAST(strftime('%s', s.ended_at) AS INTEGER) - CAST(strftime('%s', s.started_at) AS INTEGER))
      ELSE 0 END
  ), 0) AS total_playtime_seconds,
  MAX(s.started_at) AS last_played_at
FROM games g
LEFT JOIN play_sessions s ON s.game_id = g.id
";

/// Insert a new game and return its assigned id.
pub fn create(conn: &Connection, game: &NewGame) -> AppResult<i64> {
    let created_at = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO games
          (name, launch_target, monitor_mode, monitor_process_name, arguments, image_path, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            game.name,
            game.launch_target,
            game.monitor_mode.as_db_str(),
            game.monitor_process_name,
            game.arguments,
            game.image_path,
            created_at,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// List all games ordered by name.
pub fn list(conn: &Connection) -> AppResult<Vec<Game>> {
    let sql = format!("{SELECT_GAMES} GROUP BY g.id ORDER BY g.name COLLATE NOCASE");
    let mut stmt = conn.prepare(&sql)?;
    super::collect_rows(&mut stmt, [], map_game)
}

/// Fetch a single game by id.
pub fn get(conn: &Connection, id: i64) -> AppResult<Game> {
    let sql = format!("{SELECT_GAMES} WHERE g.id = ?1 GROUP BY g.id");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![id], map_game)?;
    match rows.next() {
        Some(row) => Ok(row?),
        None => Err(AppError::database(format!("game {id} not found"))),
    }
}

/// Resolve the game to use for "Play Now".
///
/// Prefers the cached `settings.last_played_game_id` when it points to a live
/// game row. If the setting is missing or stale (for example the game was
/// deleted), falls back to the game with the most recent `play_sessions.started_at`.
pub fn get_play_now(conn: &Connection) -> AppResult<Option<Game>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = 'last_played_game_id'")?;
    let cached_id = stmt
        .query_row([], |row| row.get::<_, Option<String>>(0))
        .optional()?
        .flatten()
        .and_then(|value| value.trim().parse::<i64>().ok());

    if let Some(game_id) = cached_id {
        if let Ok(game) = get(conn, game_id) {
            return Ok(Some(game));
        }
    }

    let fallback_id = conn
        .query_row(
            "SELECT s.game_id
             FROM play_sessions s
             INNER JOIN games g ON g.id = s.game_id
             ORDER BY s.started_at DESC, s.id DESC
             LIMIT 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;

    match fallback_id {
        Some(game_id) => get(conn, game_id).map(Some),
        None => Ok(None),
    }
}

/// Update mutable fields of an existing game. Returns whether a row changed.
pub fn update(conn: &Connection, id: i64, game: &NewGame) -> AppResult<bool> {
    let changed = conn.execute(
        "UPDATE games SET
           name = ?2,
           launch_target = ?3,
           monitor_mode = ?4,
           monitor_process_name = ?5,
           arguments = ?6,
           image_path = ?7
         WHERE id = ?1",
        params![
            id,
            game.name,
            game.launch_target,
            game.monitor_mode.as_db_str(),
            game.monitor_process_name,
            game.arguments,
            game.image_path,
        ],
    )?;
    Ok(changed > 0)
}

/// Delete a game by id (cascades junctions + sessions). Returns whether it existed.
pub fn delete(conn: &Connection, id: i64) -> AppResult<bool> {
    let changed = conn.execute("DELETE FROM games WHERE id = ?1", params![id])?;
    Ok(changed > 0)
}

/// Replace the set of groups a game belongs to.
pub fn set_groups(conn: &Connection, game_id: i64, group_ids: &[i64]) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM game_groups WHERE game_id = ?1",
        params![game_id],
    )?;
    for group_id in group_ids {
        tx.execute(
            "INSERT INTO game_groups (game_id, group_id) VALUES (?1, ?2)",
            params![game_id, group_id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Replace the set of directly-assigned (normal) scripts for a game.
pub fn set_scripts(conn: &Connection, game_id: i64, script_ids: &[i64]) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM game_scripts WHERE game_id = ?1",
        params![game_id],
    )?;
    for script_id in script_ids {
        tx.execute(
            "INSERT INTO game_scripts (game_id, script_id) VALUES (?1, ?2)",
            params![game_id, script_id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// The group ids a game belongs to, ascending.
pub fn group_ids(conn: &Connection, game_id: i64) -> AppResult<Vec<i64>> {
    let mut stmt =
        conn.prepare("SELECT group_id FROM game_groups WHERE game_id = ?1 ORDER BY group_id")?;
    super::collect_ids(&mut stmt, params![game_id])
}

/// The directly-assigned script ids for a game, ascending.
pub fn script_ids(conn: &Connection, game_id: i64) -> AppResult<Vec<i64>> {
    let mut stmt =
        conn.prepare("SELECT script_id FROM game_scripts WHERE game_id = ?1 ORDER BY script_id")?;
    super::collect_ids(&mut stmt, params![game_id])
}
