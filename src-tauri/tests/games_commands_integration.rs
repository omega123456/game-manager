//! Games command (`*_impl`) integration tests against an in-memory DB.

use game_manager_lib::commands::games::{
    create_game_impl, delete_game_impl, get_game_impl, get_latest_launch_run_impl,
    get_play_now_game_impl, list_games_impl, set_game_groups_impl, set_game_scripts_impl,
    update_game_impl, GameUpsertInput,
};
use game_manager_lib::db::repo::{games, groups, launch_runs, scripts, sessions};
use game_manager_lib::domain::{
    Interpreter, LaunchRunStatus, MonitorMode, PhaseConfig, PhaseMode, Provenance,
    ScriptExecutionStatus, ScriptKind, ScriptPhase,
};
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

fn resolved_script(
    script_id: i64,
    name: &str,
    phase: ScriptPhase,
) -> game_manager_lib::domain::ResolvedScript {
    game_manager_lib::domain::ResolvedScript {
        script_id,
        name: name.to_string(),
        priority: 5,
        phase,
        provenance: Provenance::Direct,
        group_name: None,
        order: 1,
        required_utility_names: Vec::new(),
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

#[test]
fn get_play_now_game_prefers_cached_setting_and_falls_back_to_recent_session() {
    let state = state();
    let alan = create_game_impl(&state, game_input("Alan Wake 2")).unwrap();
    let balatro = create_game_impl(&state, game_input("Balatro")).unwrap();

    state
        .with_db(|conn| {
            sessions::insert(
                conn,
                alan.id,
                "2026-06-10T20:00:00+00:00",
                Some("2026-06-10T21:00:00+00:00"),
            )?;
            sessions::insert(
                conn,
                balatro.id,
                "2026-06-11T20:00:00+00:00",
                Some("2026-06-11T21:00:00+00:00"),
            )?;
            Ok(())
        })
        .unwrap();

    let fallback = get_play_now_game_impl(&state)
        .unwrap()
        .expect("fallback game");
    assert_eq!(fallback.id, balatro.id);

    state
        .with_db(|conn| {
            game_manager_lib::db::repo::settings::set(
                conn,
                "last_played_game_id",
                &alan.id.to_string(),
            )
        })
        .unwrap();
    let cached = get_play_now_game_impl(&state)
        .unwrap()
        .expect("cached game");
    assert_eq!(cached.id, alan.id);

    state
        .with_db(|conn| {
            game_manager_lib::db::repo::settings::set(conn, "last_played_game_id", "999999")
        })
        .unwrap();
    let stale = get_play_now_game_impl(&state)
        .unwrap()
        .expect("stale fallback");
    assert_eq!(stale.id, balatro.id);

    delete_game_impl(&state, balatro.id).unwrap();
    let deleted_fallback = get_play_now_game_impl(&state)
        .unwrap()
        .expect("deleted fallback");
    assert_eq!(deleted_fallback.id, alan.id);
}

#[test]
fn get_play_now_game_skips_orphaned_play_session_rows() {
    let state = state();
    let live = create_game_impl(&state, game_input("Live Game")).unwrap();
    let deleted = create_game_impl(&state, game_input("Deleted Game")).unwrap();

    state
        .with_db(|conn| {
            sessions::insert(
                conn,
                live.id,
                "2026-06-10T20:00:00+00:00",
                Some("2026-06-10T21:00:00+00:00"),
            )?;
            sessions::insert(
                conn,
                deleted.id,
                "2026-06-11T20:00:00+00:00",
                Some("2026-06-11T21:00:00+00:00"),
            )?;
            conn.execute("DELETE FROM games WHERE id = ?1", [deleted.id])?;
            Ok(())
        })
        .unwrap();

    let play_now = get_play_now_game_impl(&state)
        .unwrap()
        .expect("live fallback");
    assert_eq!(play_now.id, live.id);
}

#[test]
fn get_play_now_game_returns_none_without_history() {
    let state = state();
    assert!(get_play_now_game_impl(&state).unwrap().is_none());
}

#[test]
fn get_latest_launch_run_returns_none_without_retained_run() {
    let state = state();
    let game = create_game_impl(&state, game_input("No Launch Yet")).unwrap();
    assert!(get_latest_launch_run_impl(&state, game.id)
        .unwrap()
        .is_none());
}

#[test]
fn get_latest_launch_run_returns_latest_retained_pipeline_for_game() {
    let state = state();
    let game = create_game_impl(&state, game_input("With Run")).unwrap();
    let script_id = state
        .with_db(|conn| scripts::create(conn, &normal_script("HDR Setup")))
        .unwrap();

    state
        .with_db(|conn| {
            let run = launch_runs::create_run(conn, game.id)?;
            let records = launch_runs::seed_script_records(
                conn,
                run.id,
                &[resolved_script(script_id, "HDR Setup", ScriptPhase::Before)],
            )?;
            launch_runs::update_script_record_status(
                conn,
                records[0].id,
                ScriptExecutionStatus::Succeeded,
                Some("2026-06-19T09:00:00Z"),
                Some("2026-06-19T09:00:01Z"),
                None,
            )?;
            launch_runs::set_run_status(
                conn,
                run.id,
                LaunchRunStatus::Completed,
                0,
                Some("2026-06-19T09:05:00Z"),
            )?;
            Ok(())
        })
        .unwrap();

    let latest = get_latest_launch_run_impl(&state, game.id)
        .unwrap()
        .expect("latest run");
    assert_eq!(latest.game_id, game.id);
    assert_eq!(latest.status, LaunchRunStatus::Completed);
    assert_eq!(latest.script_records.len(), 1);
    assert_eq!(
        latest.script_records[0].status,
        ScriptExecutionStatus::Succeeded
    );
}
