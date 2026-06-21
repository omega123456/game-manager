//! Verifies migration 006's `idx_play_sessions_game_id` index exists and is
//! actually used by the per-game `get` query's `play_sessions` join.
//!
//! The per-game `get` (see `db::repo::games::get`) runs `SELECT_GAMES` with a
//! `WHERE g.id = ?1 GROUP BY g.id` suffix; its `LEFT JOIN play_sessions s ON
//! s.game_id = g.id` previously forced a full `play_sessions` scan. We assert
//! the planner now resolves that join via the new index. The assertion matches
//! on the substring `USING INDEX idx_play_sessions_game_id` rather than the full
//! SCAN/SEARCH wording, which SQLite's planner can phrase differently across
//! versions.

use game_manager_lib::db::connection::open_in_memory;

/// The per-game `get` query, mirroring `db::repo::games::get` (`SELECT_GAMES`
/// plus the single-row `WHERE`/`GROUP BY` suffix). Kept in sync with the repo so
/// the plan we measure is the one the app issues.
const GET_GAME_SQL: &str = "
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
WHERE g.id = ?1 GROUP BY g.id
";

/// Collect the `detail` column of every `EXPLAIN QUERY PLAN` row, joined into
/// one string for substring assertions.
fn query_plan(conn: &rusqlite::Connection, sql: &str) -> String {
    let explain = format!("EXPLAIN QUERY PLAN {sql}");
    let mut stmt = conn.prepare(&explain).expect("prepare explain");
    let rows: Vec<String> = stmt
        .query_map([1_i64], |row| row.get::<_, String>("detail"))
        .expect("query explain")
        .map(Result::unwrap)
        .collect();
    rows.join("\n")
}

#[test]
fn migrated_db_reports_version_6_with_index() {
    let conn = open_in_memory().expect("open");

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("user_version");
    assert_eq!(
        version, 6,
        "freshly migrated DB must report schema version 6"
    );

    let index_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master \
             WHERE type='index' AND name='idx_play_sessions_game_id'",
            [],
            |row| row.get(0),
        )
        .expect("index lookup");
    assert_eq!(index_exists, 1, "idx_play_sessions_game_id must exist");
}

#[test]
fn per_game_get_uses_play_sessions_index() {
    let conn = open_in_memory().expect("open");

    let plan = query_plan(&conn, GET_GAME_SQL);

    assert!(
        plan.contains("USING INDEX idx_play_sessions_game_id"),
        "per-game get must use idx_play_sessions_game_id; plan was:\n{plan}"
    );
    assert!(
        !plan.contains("SCAN play_sessions"),
        "per-game get must not full-scan play_sessions; plan was:\n{plan}"
    );
    assert!(
        !plan.to_uppercase().contains("AUTOMATIC"),
        "per-game get must not build a transient auto-index; plan was:\n{plan}"
    );
}
