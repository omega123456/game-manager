//! Resolver integration tests for merged direct/group/global execution previews.

use game_manager_lib::commands::games::{create_game_impl, get_resolved_scripts_impl, set_game_groups_impl, set_game_scripts_impl, GameUpsertInput};
use game_manager_lib::db::repo::{groups, scripts};
use game_manager_lib::domain::{Interpreter, MonitorMode, PhaseConfig, PhaseMode, Provenance, ScriptKind, ScriptPhase};
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
        arguments: None,
        image_path: None,
    }
}

fn normal_script(name: &str, priority: i64, before: bool, after: bool, on_exit: bool) -> scripts::NewScript {
    scripts::NewScript {
        name: name.to_string(),
        description: None,
        kind: ScriptKind::Normal,
        priority,
        before_launch: phase(before, &format!("Write-Host before {name}")),
        after_launch: phase(after, &format!("Write-Host after {name}")),
        on_exit: phase(on_exit, &format!("Write-Host exit {name}")),
        snippet: PhaseConfig::default(),
    }
}

fn global_script(name: &str, priority: i64, before: bool, after: bool, on_exit: bool) -> scripts::NewScript {
    scripts::NewScript {
        kind: ScriptKind::Global,
        ..normal_script(name, priority, before, after, on_exit)
    }
}

fn utility_script(name: &str, requires: &[i64]) -> scripts::NewScript {
    let script = scripts::NewScript {
        name: name.to_string(),
        description: None,
        kind: ScriptKind::Utility,
        priority: 1,
        before_launch: PhaseConfig::default(),
        after_launch: PhaseConfig::default(),
        on_exit: PhaseConfig::default(),
        snippet: PhaseConfig {
            mode: PhaseMode::Inline,
            path: None,
            inline: Some(format!("function {name} {{}}")),
            interpreter: Some(Interpreter::Powershell),
        },
    };
    let _ = requires;
    script
}

fn phase(enabled: bool, inline: &str) -> PhaseConfig {
    if enabled {
        PhaseConfig {
            mode: PhaseMode::Inline,
            path: None,
            inline: Some(inline.to_string()),
            interpreter: Some(Interpreter::Powershell),
        }
    } else {
        PhaseConfig::default()
    }
}

#[test]
fn resolved_scripts_merge_dedupe_sort_and_exclude_utilities() {
    let state = state();
    let game = create_game_impl(&state, game_input("Alan Wake 2")).unwrap();

    let (group_id, direct_id, group_only_id, global_id, shared_utility_id, nested_utility_id) = state
        .with_db(|conn| {
            let group_id = groups::create(
                conn,
                &groups::NewGroup {
                    name: "HDR Games".into(),
                    description: None,
                },
            )?;
            let direct_id = scripts::create(conn, &normal_script("Alpha Direct", 7, true, true, false))?;
            let group_only_id = scripts::create(conn, &normal_script("Beta Group", 9, true, false, true))?;
            let global_id = scripts::create(conn, &global_script("Gamma Global", 8, true, false, true))?;
            let shared_utility_id = scripts::create(conn, &utility_script("SaveLib", &[]))?;
            let nested_utility_id = scripts::create(conn, &utility_script("PowerHelpers", &[]))?;

            scripts::set_dependencies(conn, direct_id, &[shared_utility_id])?;
            scripts::set_dependencies(conn, group_only_id, &[shared_utility_id, nested_utility_id])?;
            scripts::set_dependencies(conn, global_id, &[nested_utility_id])?;
            scripts::set_dependencies(conn, shared_utility_id, &[nested_utility_id])?;
            groups::set_scripts(conn, group_id, &[direct_id, group_only_id])?;
            Ok((group_id, direct_id, group_only_id, global_id, shared_utility_id, nested_utility_id))
        })
        .unwrap();

    let _ = (shared_utility_id, nested_utility_id);

    set_game_scripts_impl(&state, game.id, vec![direct_id]).unwrap();
    set_game_groups_impl(&state, game.id, vec![group_id]).unwrap();

    let resolved = get_resolved_scripts_impl(&state, game.id).unwrap();

    assert!(resolved.iter().all(|entry| entry.script_id != shared_utility_id));
    assert!(resolved.iter().all(|entry| entry.script_id != nested_utility_id));

    let before = resolved
        .iter()
        .filter(|entry| entry.phase == ScriptPhase::Before)
        .collect::<Vec<_>>();
    assert_eq!(before.len(), 3);
    assert_eq!(before[0].script_id, group_only_id);
    assert_eq!(before[0].provenance, Provenance::Group);
    assert_eq!(before[0].group_name.as_deref(), Some("HDR Games"));
    assert_eq!(before[0].required_utility_names, vec!["PowerHelpers", "SaveLib"]);
    assert_eq!(before[0].order, 1);

    assert_eq!(before[1].script_id, global_id);
    assert_eq!(before[1].provenance, Provenance::Global);
    assert_eq!(before[1].order, 2);

    assert_eq!(before[2].script_id, direct_id);
    assert_eq!(before[2].provenance, Provenance::Direct);
    assert!(before[2].group_name.is_none());
    assert_eq!(before[2].required_utility_names, vec!["PowerHelpers", "SaveLib"]);

    let after = resolved
        .iter()
        .filter(|entry| entry.phase == ScriptPhase::After)
        .collect::<Vec<_>>();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].script_id, direct_id);
    assert_eq!(after[0].provenance, Provenance::Direct);

    let on_exit = resolved
        .iter()
        .filter(|entry| entry.phase == ScriptPhase::OnExit)
        .collect::<Vec<_>>();
    assert_eq!(on_exit.len(), 2);
    assert_eq!(on_exit[0].script_id, group_only_id);
    assert_eq!(on_exit[1].script_id, global_id);
}
