//! Connection + error-bridge + edge-path coverage tests.

use game_manager_lib::db::connection::{open, open_in_memory};
use game_manager_lib::db::repo::{games, groups, logs, scripts, sessions};
use game_manager_lib::error::AppError;

#[test]
fn opens_file_database_and_migrates() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("gm.db");
    let conn = open(&path).expect("open file db");

    // A second open on the same file must succeed (migrations idempotent on disk).
    drop(conn);
    let conn2 = open(&path).expect("reopen file db");
    let tables: i64 = conn2
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(tables, 13);
}

#[test]
fn rusqlite_error_bridges_into_app_error() {
    let err: AppError = rusqlite::Error::QueryReturnedNoRows.into();
    assert!(err.to_string().contains("database error"));

    let io = AppError::Io("disk".into());
    assert_eq!(io.to_string(), "io error: disk");
    let db = AppError::database("locked");
    assert_eq!(db.to_string(), "database error: locked");
}

#[test]
fn not_found_paths_return_errors() {
    let conn = open_in_memory().unwrap();
    assert!(games::get(&conn, 404).is_err());
    assert!(scripts::get(&conn, 404).is_err());
    assert!(groups::get(&conn, 404).is_err());
    assert!(sessions::get(&conn, 404).is_err());
    // logs::get returns Ok(None) for a missing id.
    assert!(logs::get(&conn, 404).unwrap().is_none());
    // updates/deletes on absent rows report no change.
    assert!(!scripts::set_kind(&conn, 404, game_manager_lib::domain::ScriptKind::Global).unwrap());
}

#[test]
fn empty_collections_and_clears() {
    let conn = open_in_memory().unwrap();
    assert!(games::list(&conn).unwrap().is_empty());
    assert!(scripts::list(&conn).unwrap().is_empty());
    assert!(groups::list(&conn).unwrap().is_empty());

    let game = games::create(
        &conn,
        &games::NewGame {
            name: "G".into(),
            launch_target: "g.exe".into(),
            monitor_mode: game_manager_lib::domain::MonitorMode::Tree,
            monitor_process_name: None,
            arguments: None,
            image_path: None,
        },
    )
    .unwrap();
    // Clearing assignments (empty slices) is a valid no-op replace.
    games::set_groups(&conn, game, &[]).unwrap();
    games::set_scripts(&conn, game, &[]).unwrap();
    assert!(games::group_ids(&conn, game).unwrap().is_empty());
    assert!(games::script_ids(&conn, game).unwrap().is_empty());

    let script = scripts::create(
        &conn,
        &scripts::NewScript {
            name: "S".into(),
            description: None,
            kind: game_manager_lib::domain::ScriptKind::Normal,
            priority: 1,
            before_launch: Default::default(),
            after_launch: Default::default(),
            on_exit: Default::default(),
            snippet: Default::default(),
        },
    )
    .unwrap();
    scripts::set_dependencies(&conn, script, &[]).unwrap();
    assert!(scripts::require_ids(&conn, script).unwrap().is_empty());
    assert!(!sessions::end(&conn, 999).unwrap());
}
