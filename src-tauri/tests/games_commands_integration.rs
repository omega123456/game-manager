//! Games command (`*_impl`) integration tests against an in-memory DB.

use game_manager_lib::commands::games::{
    create_game_impl, delete_game_impl, get_game_impl, list_games_impl, set_game_groups_impl,
    set_game_scripts_impl, update_game_impl, GameUpsertInput,
};
use game_manager_lib::db::repo::{games, groups, scripts, sessions};
use game_manager_lib::domain::{Interpreter, MonitorMode, PhaseConfig, PhaseMode, ScriptKind};
use game_manager_lib::state::AppState;

fn state() -> AppState {
    AppState::in_memory().unwrap()
}

fn game_input(name: &str) -> GameUpsertInput {
    GameUpsertInput {
        name: name.to_string(),
        launch_target: format!("C:/Games/{name}.exe"),
        monitor_mode: MonitorMode::Tree,
        monitor_process_name: None,
        arguments: Some("  -windowed  ".to_string()),
        image_path: Some("  C:/Art/cover.png ".to_string()),
    }
}

fn normal_script(name: &str) -> scripts::NewScript {
    scripts::NewScript {
        name: name.to_string(),
        description: None,
        kind: ScriptKind::Normal,
        priority: 5,
        before_launch: PhaseConfig {
            mode: PhaseMode::Inline,
            path: None,
            inline: Some("Write-Host hi".to_string()),
            interpreter: Some(Interpreter::Powershell),
        },
        after_launch: PhaseConfig::default(),
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
fn create_update_get_and_list_games_round_trip() {
    let state = state();
    let created = create_game_impl(&state, game_input("Elden Ring")).unwrap();
    assert_eq!(created.name, "Elden Ring");
    assert_eq!(created.arguments.as_deref(), Some("-windowed"));
    assert_eq!(created.image_path.as_deref(), Some("C:/Art/cover.png"));
    assert!(created.group_ids.is_empty());
    assert_eq!(created.total_playtime_seconds, 0);

    let listed = list_games_impl(&state).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, created.id);

    let mut update = game_input("Elden Ring Nightreign");
    update.monitor_mode = MonitorMode::Named;
    update.monitor_process_name = Some("  nightreign.exe ".to_string());
    update.image_path = Some(" ".to_string());
    let updated = update_game_impl(&state, created.id, update).unwrap();
    assert_eq!(updated.name, "Elden Ring Nightreign");
    assert_eq!(updated.monitor_mode, MonitorMode::Named);
    assert_eq!(
        updated.monitor_process_name.as_deref(),
        Some("nightreign.exe")
    );
    assert!(updated.image_path.is_none());

    let fetched = get_game_impl(&state, created.id).unwrap();
    assert_eq!(fetched.id, created.id);
    assert_eq!(fetched.monitor_mode, MonitorMode::Named);
}

#[test]
fn named_monitor_mode_requires_process_name() {
    let state = state();
    let mut input = game_input("Bad");
    input.monitor_mode = MonitorMode::Named;
    input.monitor_process_name = Some("   ".to_string());

    let err = create_game_impl(&state, input).expect_err("validation should fail");
    assert_eq!(
        err.to_string(),
        "monitorProcessName is required when monitorMode is named"
    );
}

#[test]
fn set_assignments_and_delete_game_cascades_sessions_and_junctions() {
    let state = state();
    let created = create_game_impl(&state, game_input("Cyberpunk 2077")).unwrap();

    let (group_a, group_b, script_normal) = state
        .with_db(|conn| {
            let group_a = groups::create(
                conn,
                &groups::NewGroup {
                    name: "RPG".into(),
                    description: None,
                },
            )?;
            let group_b = groups::create(
                conn,
                &groups::NewGroup {
                    name: "HDR".into(),
                    description: None,
                },
            )?;
            let script_normal = scripts::create(conn, &normal_script("HDR Setup"))?;
            sessions::insert(
                conn,
                created.id,
                "2026-01-01T00:00:00+00:00",
                Some("2026-01-01T00:45:00+00:00"),
            )?;
            Ok((group_a, group_b, script_normal))
        })
        .unwrap();

    let groups = set_game_groups_impl(&state, created.id, vec![group_b, group_a]).unwrap();
    assert_eq!(groups, vec![group_a, group_b]);

    let scripts = set_game_scripts_impl(&state, created.id, vec![script_normal]).unwrap();
    assert_eq!(scripts, vec![script_normal]);

    let hydrated = get_game_impl(&state, created.id).unwrap();
    assert_eq!(hydrated.group_ids, vec![group_a, group_b]);
    assert_eq!(hydrated.total_playtime_seconds, 2700);
    assert_eq!(
        hydrated.last_played_at.as_deref(),
        Some("2026-01-01T00:00:00+00:00")
    );

    delete_game_impl(&state, created.id).unwrap();

    state
        .with_db(|conn| {
            assert!(games::get(conn, created.id).is_err());
            assert!(games::group_ids(conn, created.id).unwrap().is_empty());
            assert!(games::script_ids(conn, created.id).unwrap().is_empty());
            assert!(sessions::list_for_game(conn, created.id)
                .unwrap()
                .is_empty());
            Ok(())
        })
        .unwrap();
}

#[test]
fn set_game_scripts_rejects_non_normal_scripts() {
    let state = state();
    let created = create_game_impl(&state, game_input("Control")).unwrap();
    let utility_id = state
        .with_db(|conn| scripts::create(conn, &utility_script("Shared Helpers")))
        .unwrap();

    let err = set_game_scripts_impl(&state, created.id, vec![utility_id]).expect_err("invalid");
    assert!(err
        .to_string()
        .contains("game script assignments only allow normal scripts"));
}

#[test]
fn delete_game_errors_when_missing() {
    let state = state();
    let err = delete_game_impl(&state, 9999).expect_err("missing game should error");
    assert_eq!(err.to_string(), "game 9999 not found");
}

#[test]
fn create_and_update_validate_required_fields() {
    let state = state();

    let mut blank_name = game_input("Valid");
    blank_name.name = "   ".to_string();
    assert!(create_game_impl(&state, blank_name).is_err());

    let mut blank_target = game_input("Valid");
    blank_target.launch_target = "  ".to_string();
    assert!(create_game_impl(&state, blank_target).is_err());

    let err = update_game_impl(&state, 9999, game_input("Missing"))
        .expect_err("missing game should error on update");
    assert_eq!(err.to_string(), "game 9999 not found");
}
