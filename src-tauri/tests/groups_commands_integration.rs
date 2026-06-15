//! Groups command (`*_impl`) integration tests against an in-memory DB.
//!
//! Covers CRUD, script assignment persistence, script-kind validation, and
//! cascading cleanup of `group_scripts` + `game_groups` on delete.

use game_manager_lib::commands::games::{create_game_impl, set_game_groups_impl, GameUpsertInput};
use game_manager_lib::commands::groups::{
    create_group_impl, delete_group_impl, get_group_impl, list_groups_impl, set_group_scripts_impl,
    update_group_impl, GroupUpsertInput,
};
use game_manager_lib::commands::scripts::{create_script_impl, PhaseInput, ScriptUpsertInput};
use game_manager_lib::domain::{Interpreter, MonitorMode, PhaseMode, ScriptKind};
use game_manager_lib::state::AppState;

fn state() -> AppState {
    AppState::in_memory().unwrap()
}

fn none_phase() -> PhaseInput {
    PhaseInput::default()
}

fn inline_phase(code: &str) -> PhaseInput {
    PhaseInput {
        mode: PhaseMode::Inline,
        path: None,
        inline: Some(code.to_string()),
        interpreter: Some(Interpreter::Powershell),
    }
}

fn group_input(name: &str) -> GroupUpsertInput {
    GroupUpsertInput {
        name: name.to_string(),
        description: Some("  reusable setup  ".to_string()),
    }
}

fn normal_script_input(name: &str) -> ScriptUpsertInput {
    ScriptUpsertInput {
        name: name.to_string(),
        description: None,
        kind: ScriptKind::Normal,
        priority: 5,
        before_launch: inline_phase("Write-Host before"),
        after_launch: none_phase(),
        on_exit: none_phase(),
        snippet: none_phase(),
    }
}

fn utility_script_input(name: &str) -> ScriptUpsertInput {
    ScriptUpsertInput {
        name: name.to_string(),
        description: None,
        kind: ScriptKind::Utility,
        priority: 1,
        before_launch: none_phase(),
        after_launch: none_phase(),
        on_exit: none_phase(),
        snippet: inline_phase("function Helper {}"),
    }
}

fn game_input(name: &str) -> GameUpsertInput {
    GameUpsertInput {
        name: name.to_string(),
        launch_target: format!("C:/Games/{name}.exe"),
        monitor_mode: MonitorMode::Tree,
        monitor_process_name: None,
        arguments: None,
        image_path: None,
    }
}

#[test]
fn create_update_get_and_list_round_trip() {
    let state = state();
    let created = create_group_impl(&state, group_input("HDR Games")).unwrap();

    assert_eq!(created.name, "HDR Games");
    assert_eq!(created.description.as_deref(), Some("reusable setup"));
    assert!(created.script_ids.is_empty());
    assert!(created.game_ids.is_empty());

    let fetched = get_group_impl(&state, created.id).unwrap();
    assert_eq!(fetched, created);

    let updated = update_group_impl(
        &state,
        created.id,
        GroupUpsertInput {
            name: "Deck Verified".to_string(),
            description: Some("  portable tweaks ".to_string()),
        },
    )
    .unwrap();
    assert_eq!(updated.name, "Deck Verified");
    assert_eq!(updated.description.as_deref(), Some("portable tweaks"));

    let listed = list_groups_impl(&state).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0], updated);
}

#[test]
fn blank_name_is_rejected() {
    let state = state();
    let err = create_group_impl(
        &state,
        GroupUpsertInput {
            name: "   ".to_string(),
            description: None,
        },
    )
    .expect_err("blank name");
    assert_eq!(err.to_string(), "group name is required");
}

#[test]
fn update_and_delete_missing_group_error() {
    let state = state();
    let update_err = update_group_impl(&state, 77, group_input("Missing")).expect_err("missing");
    assert_eq!(update_err.to_string(), "group 77 not found");

    let delete_err = delete_group_impl(&state, 77).expect_err("missing");
    assert_eq!(delete_err.to_string(), "group 77 not found");
}

#[test]
fn set_group_scripts_persists_sorted_ids_and_dedupes() {
    let state = state();
    let group = create_group_impl(&state, group_input("HDR Games")).unwrap();
    let script_a = create_script_impl(&state, normal_script_input("Auto HDR")).unwrap();
    let script_b = create_script_impl(&state, normal_script_input("DLSS Toggle")).unwrap();

    let saved =
        set_group_scripts_impl(&state, group.id, vec![script_b.id, script_a.id, script_b.id])
            .unwrap();
    assert_eq!(saved, vec![script_a.id, script_b.id]);

    let hydrated = get_group_impl(&state, group.id).unwrap();
    assert_eq!(hydrated.script_ids, vec![script_a.id, script_b.id]);
}

#[test]
fn set_group_scripts_rejects_non_normal_scripts() {
    let state = state();
    let group = create_group_impl(&state, group_input("HDR Games")).unwrap();
    let utility = create_script_impl(&state, utility_script_input("Helper")).unwrap();

    let err = set_group_scripts_impl(&state, group.id, vec![utility.id]).expect_err("utility");
    assert!(err
        .to_string()
        .contains("group script assignments only allow normal scripts"));
}

#[test]
fn set_group_scripts_errors_for_missing_group_or_script() {
    let state = state();
    let group = create_group_impl(&state, group_input("HDR Games")).unwrap();
    let missing_script = set_group_scripts_impl(&state, group.id, vec![999]).expect_err("script");
    assert!(missing_script.to_string().contains("not found"));

    let script = create_script_impl(&state, normal_script_input("Auto HDR")).unwrap();
    let missing_group = set_group_scripts_impl(&state, 999, vec![script.id]).expect_err("group");
    assert!(missing_group.to_string().contains("not found"));
}

#[test]
fn deleting_group_cascades_group_scripts_and_game_groups() {
    let state = state();
    let group = create_group_impl(&state, group_input("HDR Games")).unwrap();
    let script = create_script_impl(&state, normal_script_input("Auto HDR")).unwrap();
    let game = create_game_impl(&state, game_input("Alan Wake 2")).unwrap();

    set_group_scripts_impl(&state, group.id, vec![script.id]).unwrap();
    let saved_groups = set_game_groups_impl(&state, game.id, vec![group.id]).unwrap();
    assert_eq!(saved_groups, vec![group.id]);

    let before_delete = get_group_impl(&state, group.id).unwrap();
    assert_eq!(before_delete.script_ids, vec![script.id]);
    assert_eq!(before_delete.game_ids, vec![game.id]);

    delete_group_impl(&state, group.id).unwrap();

    assert!(get_group_impl(&state, group.id).is_err());

    let game_after = game_manager_lib::commands::games::get_game_impl(&state, game.id).unwrap();
    assert_eq!(game_after.id, game.id);
    let remaining_group_ids = state
        .with_db(|conn| game_manager_lib::db::repo::games::group_ids(conn, game.id))
        .unwrap();
    assert!(remaining_group_ids.is_empty());

    let group_script_count = state
        .with_db(|conn| {
            Ok(conn.query_row(
                "SELECT COUNT(*) FROM group_scripts WHERE group_id = ?1",
                [group.id],
                |row| row.get::<_, i64>(0),
            )?)
        })
        .unwrap();
    assert_eq!(group_script_count, 0);
}
