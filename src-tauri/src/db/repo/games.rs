//! Games repository.
//!
//! Read/write helpers returning [`Game`] domain structs, including computed
//! playtime aggregates derived from `play_sessions`. No Tauri command handlers
//! live here — those land in Phase B1.

use rusqlite::{params, Connection, Row};

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
        created_at: row.get("created_at")?,
        total_playtime_seconds: row.get("total_playtime_seconds")?,
        last_played_at: row.get("last_played_at")?,
    })
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
