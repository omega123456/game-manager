//! Logging facade + 7-day retention + `log_frontend` command integration tests.

use chrono::{Duration, Utc};
use game_manager_lib::commands::logging::log_frontend_impl;
use game_manager_lib::db::connection::open_in_memory;
use game_manager_lib::db::repo::logs;
use game_manager_lib::domain::LogLevel;
use game_manager_lib::logging::{run_retention, write_log, RETENTION_DAYS};
use game_manager_lib::state::AppState;

#[test]
fn write_log_persists_and_mirrors() {
    let conn = open_in_memory().unwrap();
    // Seed a game + script so the optional FKs resolve.
    conn.execute(
        "INSERT INTO games (id, name, launch_target, created_at)
         VALUES (1, 'G', 'g.exe', '2026-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO scripts (id, name, kind, created_at)
         VALUES (2, 'S', 'normal', '2026-01-01T00:00:00Z')",
        [],
    )
    .unwrap();

    let id = write_log(
        &conn,
        LogLevel::Warn,
        "launch",
        "script failed",
        Some(1),
        Some(2),
        Some("{\"code\":1}"),
    )
    .unwrap();
    let row = logs::get(&conn, id).unwrap().expect("row exists");
    assert_eq!(row.level, LogLevel::Warn);
    assert_eq!(row.category, "launch");
    assert_eq!(row.message, "script failed");
    assert_eq!(row.game_id, Some(1));
    assert_eq!(row.script_id, Some(2));
    assert_eq!(row.details.as_deref(), Some("{\"code\":1}"));

    // Exercise every level branch in the tracing mirror.
    for level in [
        LogLevel::Debug,
        LogLevel::Info,
        LogLevel::Warn,
        LogLevel::Error,
    ] {
        write_log(&conn, level, "c", "m", None, None, None).unwrap();
    }
    assert!(logs::count(&conn).unwrap() >= 5);
    assert!(!logs::list_recent(&conn, 3).unwrap().is_empty());
}

#[test]
fn retention_deletes_old_rows_and_vacuums() {
    let conn = open_in_memory().unwrap();

    // One fresh row, one row dated well beyond the retention window.
    write_log(&conn, LogLevel::Info, "c", "fresh", None, None, None).unwrap();
    let old_ts = (Utc::now() - Duration::days(RETENTION_DAYS + 3)).to_rfc3339();
    logs::insert(
        &conn,
        &logs::NewLog {
            ts: old_ts,
            level: LogLevel::Error,
            category: "c".to_string(),
            message: "stale".into(),
            game_id: None,
            script_id: None,
            details: None,
        },
    )
    .unwrap();
    assert_eq!(logs::count(&conn).unwrap(), 2);

    let removed = run_retention(&conn).unwrap();
    assert_eq!(removed, 1, "exactly the stale row must be pruned");
    assert_eq!(logs::count(&conn).unwrap(), 1);

    // Running again with nothing stale removes zero and still succeeds (vacuum runs).
    assert_eq!(run_retention(&conn).unwrap(), 0);
}

#[test]
fn log_frontend_persists_row_readable_via_repo() {
    let state = AppState::in_memory().unwrap();

    let id = log_frontend_impl(&state, "error", Some("ui"), "boom", Some("stack")).unwrap();
    state
        .with_db(|conn| {
            let row = logs::get(conn, id).unwrap().expect("row");
            assert_eq!(row.level, LogLevel::Error);
            assert_eq!(row.category, "ui");
            assert_eq!(row.message, "boom");
            assert_eq!(row.details.as_deref(), Some("stack"));
            Ok(())
        })
        .unwrap();

    // Default category + level-string variants (incl. trace->debug and fallback).
    let id2 = log_frontend_impl(&state, "trace", None, "t", None).unwrap();
    let id3 = log_frontend_impl(&state, "bogus", None, "b", None).unwrap();
    let id4 = log_frontend_impl(&state, "warn", None, "w", None).unwrap();
    let id5 = log_frontend_impl(&state, "info", None, "i", None).unwrap();
    let id6 = log_frontend_impl(&state, "debug", None, "d", None).unwrap();
    state
        .with_db(|conn| {
            assert_eq!(
                logs::get(conn, id2).unwrap().unwrap().level,
                LogLevel::Debug
            );
            assert_eq!(logs::get(conn, id3).unwrap().unwrap().level, LogLevel::Info);
            assert_eq!(logs::get(conn, id4).unwrap().unwrap().level, LogLevel::Warn);
            assert_eq!(logs::get(conn, id5).unwrap().unwrap().level, LogLevel::Info);
            assert_eq!(
                logs::get(conn, id6).unwrap().unwrap().level,
                LogLevel::Debug
            );
            // Default category applied.
            assert_eq!(logs::get(conn, id2).unwrap().unwrap().category, "frontend");
            Ok(())
        })
        .unwrap();
}
