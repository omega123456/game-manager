//! Repository CRUD + domain DTO round-trip integration tests.

use game_manager_lib::db::connection::open_in_memory;
use game_manager_lib::db::repo::{games, groups, scripts, sessions, settings};
use game_manager_lib::domain::{
    Interpreter, LogLevel, MonitorMode, PhaseConfig, PhaseMode, Provenance, ScriptPhase,
    ResolvedScript, ScriptKind,
};

fn sample_game(name: &str) -> games::NewGame {
    games::NewGame {
        name: name.to_string(),
        launch_target: format!("C:/Games/{name}.exe"),
        monitor_mode: MonitorMode::Tree,
        monitor_process_name: None,
        arguments: Some("-windowed".to_string()),
        image_path: None,
    }
}

#[test]
fn games_crud_and_assignments() {
    let conn = open_in_memory().unwrap();
    let id = games::create(&conn, &sample_game("Elden Ring")).unwrap();
    let fetched = games::get(&conn, id).unwrap();
    assert_eq!(fetched.name, "Elden Ring");
    assert_eq!(fetched.arguments.as_deref(), Some("-windowed"));
    assert!(fetched.group_ids.is_empty());
    assert_eq!(fetched.total_playtime_seconds, 0);
    assert!(fetched.last_played_at.is_none());

    let listed = games::list(&conn).unwrap();
    assert_eq!(listed.len(), 1);

    let mut update = sample_game("Elden Ring Updated");
    update.monitor_mode = MonitorMode::Named;
    update.monitor_process_name = Some("eldenring.exe".to_string());
    assert!(games::update(&conn, id, &update).unwrap());
    let updated = games::get(&conn, id).unwrap();
    assert_eq!(updated.name, "Elden Ring Updated");
    assert_eq!(updated.monitor_mode, MonitorMode::Named);

    assert!(games::delete(&conn, id).unwrap());
    assert!(!games::delete(&conn, id).unwrap());
    assert!(games::get(&conn, id).is_err());
}

#[test]
fn games_aggregate_playtime() {
    let conn = open_in_memory().unwrap();
    let id = games::create(&conn, &sample_game("Neon")).unwrap();
    // Two completed sessions: 3600s + 1800s = 5400s; one open session ignored.
    sessions::insert(
        &conn,
        id,
        "2026-01-01T00:00:00+00:00",
        Some("2026-01-01T01:00:00+00:00"),
    )
    .unwrap();
    sessions::insert(
        &conn,
        id,
        "2026-02-01T10:00:00+00:00",
        Some("2026-02-01T10:30:00+00:00"),
    )
    .unwrap();
    sessions::insert(&conn, id, "2026-03-01T00:00:00+00:00", None).unwrap();

    let game = games::get(&conn, id).unwrap();
    assert_eq!(game.total_playtime_seconds, 5400);
    assert_eq!(
        game.last_played_at.as_deref(),
        Some("2026-03-01T00:00:00+00:00")
    );
}

#[test]
fn games_groups_and_scripts_assignment_roundtrip() {
    let conn = open_in_memory().unwrap();
    let game = games::create(&conn, &sample_game("X")).unwrap();
    let g1 = groups::create(
        &conn,
        &groups::NewGroup {
            name: "A".into(),
            description: None,
        },
    )
    .unwrap();
    let g2 = groups::create(
        &conn,
        &groups::NewGroup {
            name: "B".into(),
            description: None,
        },
    )
    .unwrap();
    let s1 = scripts::create(&conn, &normal_script("S1")).unwrap();

    games::set_groups(&conn, game, &[g1, g2]).unwrap();
    games::set_scripts(&conn, game, &[s1]).unwrap();
    assert_eq!(games::group_ids(&conn, game).unwrap(), vec![g1, g2]);
    assert_eq!(games::script_ids(&conn, game).unwrap(), vec![s1]);

    // Re-assigning replaces.
    games::set_groups(&conn, game, &[g2]).unwrap();
    assert_eq!(games::group_ids(&conn, game).unwrap(), vec![g2]);
}

fn normal_script(name: &str) -> scripts::NewScript {
    scripts::NewScript {
        name: name.to_string(),
        description: Some("desc".to_string()),
        kind: ScriptKind::Normal,
        priority: 7,
        before_launch: PhaseConfig {
            mode: PhaseMode::Inline,
            path: None,
            inline: Some("Write-Host hi".to_string()),
            interpreter: Some(Interpreter::Powershell),
        },
        after_launch: PhaseConfig {
            mode: PhaseMode::Path,
            path: Some("C:/cmd/after.bat".to_string()),
            inline: None,
            interpreter: None,
        },
        on_exit: PhaseConfig::default(),
        snippet: PhaseConfig::default(),
    }
}

fn utility_script(name: &str) -> scripts::NewScript {
    scripts::NewScript {
        name: name.to_string(),
        description: None,
        kind: ScriptKind::Utility,
        priority: 5,
        before_launch: PhaseConfig::default(),
        after_launch: PhaseConfig::default(),
        on_exit: PhaseConfig::default(),
        snippet: PhaseConfig {
            mode: PhaseMode::Inline,
            path: None,
            inline: Some("function Helper {}".to_string()),
            interpreter: Some(Interpreter::Powershell),
        },
    }
}

#[test]
fn scripts_crud_phases_and_requires() {
    let conn = open_in_memory().unwrap();
    let util = scripts::create(&conn, &utility_script("SaveLib")).unwrap();
    let normal = scripts::create(&conn, &normal_script("AutoSave")).unwrap();

    let fetched = scripts::get(&conn, normal).unwrap();
    assert_eq!(fetched.kind, ScriptKind::Normal);
    assert_eq!(fetched.priority, 7);
    assert_eq!(fetched.before_launch.mode, PhaseMode::Inline);
    assert_eq!(
        fetched.before_launch.interpreter,
        Some(Interpreter::Powershell)
    );
    assert_eq!(fetched.after_launch.mode, PhaseMode::Path);
    assert_eq!(
        fetched.after_launch.path.as_deref(),
        Some("C:/cmd/after.bat")
    );
    assert_eq!(fetched.on_exit.mode, PhaseMode::None);
    assert!(fetched.requires.is_empty());

    let util_fetched = scripts::get(&conn, util).unwrap();
    assert_eq!(util_fetched.snippet.mode, PhaseMode::Inline);
    assert_eq!(util_fetched.before_launch.mode, PhaseMode::None);

    // Wire a require edge.
    scripts::set_dependencies(&conn, normal, &[util]).unwrap();
    assert_eq!(scripts::get(&conn, normal).unwrap().requires, vec![util]);
    assert_eq!(scripts::require_ids(&conn, normal).unwrap(), vec![util]);

    // Update + set_kind.
    let mut upd = normal_script("AutoSave2");
    upd.priority = 3;
    assert!(scripts::update(&conn, normal, &upd).unwrap());
    assert_eq!(scripts::get(&conn, normal).unwrap().priority, 3);
    assert!(scripts::set_kind(&conn, normal, ScriptKind::Global).unwrap());
    assert_eq!(
        scripts::get(&conn, normal).unwrap().kind,
        ScriptKind::Global
    );

    assert_eq!(scripts::list(&conn).unwrap().len(), 2);
    assert!(scripts::delete(&conn, normal).unwrap());
    assert!(scripts::get(&conn, normal).is_err());
}

#[test]
fn groups_crud_and_membership() {
    let conn = open_in_memory().unwrap();
    let g = groups::create(
        &conn,
        &groups::NewGroup {
            name: "Core RPG".into(),
            description: Some("rpgs".into()),
        },
    )
    .unwrap();
    let s = scripts::create(&conn, &normal_script("FX")).unwrap();
    let game = games::create(&conn, &sample_game("Y")).unwrap();

    groups::set_scripts(&conn, g, &[s]).unwrap();
    games::set_groups(&conn, game, &[g]).unwrap();

    let fetched = groups::get(&conn, g).unwrap();
    assert_eq!(fetched.name, "Core RPG");
    assert_eq!(fetched.script_ids, vec![s]);
    assert_eq!(fetched.game_ids, vec![game]);

    assert!(groups::update(
        &conn,
        g,
        &groups::NewGroup {
            name: "Renamed".into(),
            description: None
        }
    )
    .unwrap());
    assert_eq!(groups::get(&conn, g).unwrap().name, "Renamed");
    assert_eq!(groups::list(&conn).unwrap().len(), 1);
    assert!(groups::delete(&conn, g).unwrap());
    assert!(groups::get(&conn, g).is_err());
}

#[test]
fn sessions_lifecycle() {
    let conn = open_in_memory().unwrap();
    let game = games::create(&conn, &sample_game("Z")).unwrap();
    let sid = sessions::start(&conn, game).unwrap();
    let open = sessions::get(&conn, sid).unwrap();
    assert!(open.ended_at.is_none());
    assert_eq!(open.game_id, game);

    assert!(sessions::end(&conn, sid).unwrap());
    assert!(sessions::get(&conn, sid).unwrap().ended_at.is_some());
    assert_eq!(sessions::list_for_game(&conn, game).unwrap().len(), 1);
    assert!(sessions::get(&conn, 9999).is_err());
}

#[test]
fn settings_roundtrip() {
    let conn = open_in_memory().unwrap();
    assert!(settings::get(&conn, "theme").unwrap().is_none());
    settings::set(&conn, "theme", "dark").unwrap();
    assert_eq!(
        settings::get(&conn, "theme").unwrap().as_deref(),
        Some("dark")
    );
    // Upsert overwrites.
    settings::set(&conn, "theme", "light").unwrap();
    assert_eq!(
        settings::get(&conn, "theme").unwrap().as_deref(),
        Some("light")
    );
    settings::set(&conn, "accent", "blue").unwrap();
    assert_eq!(settings::get_all(&conn).unwrap().len(), 2);
}

#[test]
fn domain_enums_db_string_roundtrip() {
    assert_eq!(
        MonitorMode::from_db_str(MonitorMode::Named.as_db_str()),
        Some(MonitorMode::Named)
    );
    assert_eq!(MonitorMode::from_db_str("bogus"), None);
    assert_eq!(
        ScriptKind::from_db_str(ScriptKind::Utility.as_db_str()),
        Some(ScriptKind::Utility)
    );
    assert_eq!(ScriptKind::from_db_str("x"), None);
    assert_eq!(
        PhaseMode::from_db_str(PhaseMode::Inline.as_db_str()),
        Some(PhaseMode::Inline)
    );
    assert_eq!(PhaseMode::from_db_str("x"), None);
    assert_eq!(
        Interpreter::from_db_str(Interpreter::Batch.as_db_str()),
        Some(Interpreter::Batch)
    );
    assert_eq!(Interpreter::from_db_str("x"), None);
    for level in [
        LogLevel::Debug,
        LogLevel::Info,
        LogLevel::Warn,
        LogLevel::Error,
    ] {
        assert_eq!(LogLevel::from_db_str(level.as_db_str()), Some(level));
    }
    assert_eq!(LogLevel::from_db_str("x"), None);
}

#[test]
fn dto_serializes_camel_case() {
    let conn = open_in_memory().unwrap();
    let id = games::create(&conn, &sample_game("Cam")).unwrap();
    let game = games::get(&conn, id).unwrap();
    let json = serde_json::to_string(&game).unwrap();
    assert!(json.contains("\"launchTarget\""));
    assert!(json.contains("\"totalPlaytimeSeconds\""));
    assert!(json.contains("\"monitorMode\":\"tree\""));

    let resolved = ResolvedScript {
        script_id: 1,
        name: "S".into(),
        priority: 5,
        phase: ScriptPhase::Before,
        provenance: Provenance::Group,
        group_name: Some("G".into()),
        order: 1,
        required_utility_names: vec!["Lib".into()],
    };
    let json = serde_json::to_string(&resolved).unwrap();
    assert!(json.contains("\"scriptId\":1"));
    assert!(json.contains("\"phase\":\"before\""));
    assert!(json.contains("\"provenance\":\"group\""));
    assert!(json.contains("\"requiredUtilityNames\":[\"Lib\"]"));
}
