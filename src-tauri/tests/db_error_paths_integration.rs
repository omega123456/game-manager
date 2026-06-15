//! Error-path coverage: exercises the failure arms of repository writes by
//! triggering real SQLite constraint violations.

use game_manager_lib::db::connection::open_in_memory;
use game_manager_lib::db::repo::{games, scripts, sessions};
use game_manager_lib::domain::{MonitorMode, PhaseConfig, ScriptKind};

fn named_without_process() -> games::NewGame {
    games::NewGame {
        name: "Bad".into(),
        launch_target: "g.exe".into(),
        // 'named' mode with no process name violates the CHECK constraint.
        monitor_mode: MonitorMode::Named,
        monitor_process_name: None,
        arguments: None,
        image_path: None,
    }
}

#[test]
fn game_create_propagates_constraint_error() {
    let conn = open_in_memory().unwrap();
    let err = games::create(&conn, &named_without_process()).expect_err("CHECK must fail");
    assert!(err.to_string().contains("database error"));
}

#[test]
fn game_update_propagates_constraint_error() {
    let conn = open_in_memory().unwrap();
    let id = games::create(
        &conn,
        &games::NewGame {
            name: "Good".into(),
            launch_target: "g.exe".into(),
            monitor_mode: MonitorMode::Tree,
            monitor_process_name: None,
            arguments: None,
            image_path: None,
        },
    )
    .unwrap();
    let err = games::update(&conn, id, &named_without_process()).expect_err("CHECK must fail");
    assert!(err.to_string().contains("database error"));
}

#[test]
fn script_create_propagates_constraint_error() {
    let conn = open_in_memory().unwrap();
    // priority 0 is out of the 1..=10 CHECK range.
    let bad = scripts::NewScript {
        name: "S".into(),
        description: None,
        kind: ScriptKind::Normal,
        priority: 0,
        before_launch: PhaseConfig::default(),
        after_launch: PhaseConfig::default(),
        on_exit: PhaseConfig::default(),
        snippet: PhaseConfig::default(),
    };
    assert!(scripts::create(&conn, &bad).is_err());
}

#[test]
fn set_dependencies_propagates_fk_error() {
    let conn = open_in_memory().unwrap();
    let s = scripts::create(
        &conn,
        &scripts::NewScript {
            name: "S".into(),
            description: None,
            kind: ScriptKind::Normal,
            priority: 5,
            before_launch: PhaseConfig::default(),
            after_launch: PhaseConfig::default(),
            on_exit: PhaseConfig::default(),
            snippet: PhaseConfig::default(),
        },
    )
    .unwrap();
    // Depending on a non-existent script id violates the FK -> error arm.
    assert!(scripts::set_dependencies(&conn, s, &[9999]).is_err());
}

#[test]
fn set_groups_propagates_fk_error() {
    let conn = open_in_memory().unwrap();
    let game = games::create(
        &conn,
        &games::NewGame {
            name: "G".into(),
            launch_target: "g.exe".into(),
            monitor_mode: MonitorMode::Tree,
            monitor_process_name: None,
            arguments: None,
            image_path: None,
        },
    )
    .unwrap();
    assert!(games::set_groups(&conn, game, &[9999]).is_err());
    assert!(games::set_scripts(&conn, game, &[9999]).is_err());
}

#[test]
fn session_insert_propagates_fk_error() {
    let conn = open_in_memory().unwrap();
    // game 9999 does not exist -> FK violation.
    assert!(sessions::start(&conn, 9999).is_err());
    assert!(sessions::insert(&conn, 9999, "2026-01-01T00:00:00Z", None).is_err());
}
