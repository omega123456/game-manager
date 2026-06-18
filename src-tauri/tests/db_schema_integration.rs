//! Schema + migration integration tests against a fresh in-memory database.

use game_manager_lib::db::connection::open_in_memory;
use game_manager_lib::db::migrations::{run_migrations, MIGRATIONS};

fn table_names(conn: &rusqlite::Connection) -> Vec<String> {
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .unwrap();
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    rows
}

#[test]
fn migration_creates_all_tables_and_index() {
    let conn = open_in_memory().expect("open");
    let tables = table_names(&conn);
    for expected in [
        "games",
        "scripts",
        "script_dependencies",
        "groups",
        "game_groups",
        "game_scripts",
        "group_scripts",
        "play_sessions",
        "settings",
        "logs",
    ] {
        assert!(
            tables.contains(&expected.to_string()),
            "missing table {expected}"
        );
    }

    let index_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_logs_ts'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(index_exists, 1, "idx_logs_ts must exist");
}

#[test]
fn pragmas_are_applied() {
    let conn = open_in_memory().expect("open");
    let fk: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap();
    assert_eq!(fk, 1, "foreign_keys must be ON");

    // auto_vacuum INCREMENTAL == 2
    let av: i64 = conn
        .query_row("PRAGMA auto_vacuum", [], |r| r.get(0))
        .unwrap();
    assert_eq!(av, 2, "auto_vacuum must be INCREMENTAL");

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, MIGRATIONS.last().unwrap().version);
}

#[test]
fn migrations_are_idempotent() {
    let conn = open_in_memory().expect("open");
    // Running again must be a no-op and must not error on existing tables.
    run_migrations(&conn).expect("re-run migrations");
    run_migrations(&conn).expect("re-run migrations again");
    assert_eq!(table_names(&conn).len(), 11);
}

#[test]
fn foreign_keys_are_enforced() {
    let conn = open_in_memory().expect("open");
    // game_scripts.game_id references a non-existent game -> FK violation.
    let result = conn.execute(
        "INSERT INTO game_scripts (game_id, script_id) VALUES (999, 888)",
        [],
    );
    let err = result.expect_err("FK violation must be rejected");
    assert!(
        err.to_string().to_lowercase().contains("foreign key"),
        "expected a foreign key error, got: {err}"
    );
}

#[test]
fn check_constraints_are_enforced() {
    let conn = open_in_memory().expect("open");

    // monitor_mode 'named' requires a non-empty monitor_process_name.
    let bad_named = conn.execute(
        "INSERT INTO games (name, launch_target, monitor_mode, created_at)
         VALUES ('G', 'g.exe', 'named', '2026-01-01T00:00:00Z')",
        [],
    );
    assert!(
        bad_named.is_err(),
        "named mode without process name must fail"
    );

    // priority out of range.
    let bad_priority = conn.execute(
        "INSERT INTO scripts (name, kind, priority, created_at)
         VALUES ('S', 'normal', 99, '2026-01-01T00:00:00Z')",
        [],
    );
    assert!(bad_priority.is_err(), "priority 99 must fail CHECK");

    // utility may not configure a phase.
    let bad_utility = conn.execute(
        "INSERT INTO scripts (name, kind, before_launch_mode, created_at)
         VALUES ('U', 'utility', 'inline', '2026-01-01T00:00:00Z')",
        [],
    );
    assert!(bad_utility.is_err(), "utility with a phase must fail CHECK");

    // log level must be one of the allowed values.
    let bad_level = conn.execute(
        "INSERT INTO logs (ts, level, category, message)
         VALUES ('2026-01-01T00:00:00Z', 'verbose', 'c', 'm')",
        [],
    );
    assert!(bad_level.is_err(), "invalid log level must fail CHECK");
}

#[test]
fn powershell7_interpreter_is_accepted() {
    let conn = open_in_memory().expect("open");
    let inserted = conn.execute(
        "INSERT INTO scripts (name, kind, before_launch_mode, before_launch_inline, before_launch_interpreter, created_at)
         VALUES ('Ps7', 'normal', 'inline', 'Write-Output 1', 'powershell7', '2026-01-01T00:00:00Z')",
        [],
    );
    assert!(
        inserted.is_ok(),
        "powershell7 must pass the interpreter CHECK: {inserted:?}"
    );

    // An unknown interpreter still fails.
    let bad = conn.execute(
        "INSERT INTO scripts (name, kind, before_launch_mode, before_launch_inline, before_launch_interpreter, created_at)
         VALUES ('Bad', 'normal', 'inline', 'x', 'bash', '2026-01-01T00:00:00Z')",
        [],
    );
    assert!(bad.is_err(), "unknown interpreter must fail CHECK");
}

#[test]
fn cascade_delete_removes_dependents() {
    let conn = open_in_memory().expect("open");
    conn.execute(
        "INSERT INTO games (id, name, launch_target, created_at)
         VALUES (1, 'G', 'g.exe', '2026-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO play_sessions (game_id, started_at) VALUES (1, '2026-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    conn.execute("DELETE FROM games WHERE id = 1", []).unwrap();
    let sessions: i64 = conn
        .query_row("SELECT COUNT(*) FROM play_sessions", [], |r| r.get(0))
        .unwrap();
    assert_eq!(sessions, 0, "sessions must cascade on game delete");
}

#[test]
fn log_game_fk_sets_null_on_delete() {
    let conn = open_in_memory().expect("open");
    conn.execute(
        "INSERT INTO games (id, name, launch_target, created_at)
         VALUES (1, 'G', 'g.exe', '2026-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO logs (ts, level, category, message, game_id)
         VALUES ('2026-01-01T00:00:00Z', 'info', 'c', 'm', 1)",
        [],
    )
    .unwrap();
    conn.execute("DELETE FROM games WHERE id = 1", []).unwrap();
    let game_id: Option<i64> = conn
        .query_row("SELECT game_id FROM logs", [], |r| r.get(0))
        .unwrap();
    assert!(
        game_id.is_none(),
        "log game_id must be set NULL on game delete"
    );
}
