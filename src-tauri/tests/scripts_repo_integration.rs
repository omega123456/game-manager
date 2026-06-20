//! Direct `db::repo::scripts` integration tests against an in-memory DB.

use game_manager_lib::db::connection::open_in_memory;
use game_manager_lib::db::repo::scripts::{self, NewScript};
use game_manager_lib::domain::{Interpreter, PhaseConfig, PhaseMode, ScriptKind};

fn none_phase() -> PhaseConfig {
    PhaseConfig::default()
}

fn inline_phase(code: &str) -> PhaseConfig {
    PhaseConfig {
        mode: PhaseMode::Inline,
        path: None,
        inline: Some(code.to_string()),
        interpreter: Some(Interpreter::Powershell),
    }
}

fn path_phase(path: &str) -> PhaseConfig {
    PhaseConfig {
        mode: PhaseMode::Path,
        path: Some(path.to_string()),
        inline: None,
        interpreter: None,
    }
}

fn normal_script(name: &str) -> NewScript {
    NewScript {
        name: name.to_string(),
        description: Some(format!("script {name}")),
        kind: ScriptKind::Normal,
        priority: 5,
        before_launch: inline_phase("Write-Host before"),
        after_launch: path_phase("C:/Scripts/after.ps1"),
        on_exit: none_phase(),
        snippet: none_phase(),
    }
}

fn utility_script(name: &str) -> NewScript {
    NewScript {
        name: name.to_string(),
        description: None,
        kind: ScriptKind::Utility,
        priority: 2,
        before_launch: none_phase(),
        after_launch: none_phase(),
        on_exit: none_phase(),
        snippet: inline_phase("function Helper {}"),
    }
}

#[test]
fn list_orders_case_insensitively_and_hydrates_requires() {
    let conn = open_in_memory().unwrap();
    let zebra = scripts::create(&conn, &normal_script("zebra")).unwrap();
    let helper = scripts::create(&conn, &utility_script("Helper")).unwrap();
    let alpha = scripts::create(&conn, &normal_script("Alpha")).unwrap();

    scripts::set_dependencies(&conn, zebra, &[helper]).unwrap();

    let listed = scripts::list(&conn).unwrap();
    let names: Vec<_> = listed.iter().map(|script| script.name.as_str()).collect();
    assert_eq!(names, vec!["Alpha", "Helper", "zebra"]);
    assert_eq!(
        listed
            .iter()
            .find(|script| script.id == zebra)
            .unwrap()
            .requires,
        vec![helper]
    );
    assert_eq!(
        listed
            .iter()
            .find(|script| script.id == alpha)
            .unwrap()
            .requires,
        Vec::<i64>::new()
    );
}

#[test]
fn dependency_queries_are_sorted_and_replace_previous_edges() {
    let conn = open_in_memory().unwrap();
    let owner = scripts::create(&conn, &normal_script("Owner")).unwrap();
    let util_a = scripts::create(&conn, &utility_script("A")).unwrap();
    let util_b = scripts::create(&conn, &utility_script("B")).unwrap();
    let util_c = scripts::create(&conn, &utility_script("C")).unwrap();

    scripts::set_dependencies(&conn, owner, &[util_c, util_a, util_b]).unwrap();
    assert_eq!(
        scripts::require_ids(&conn, owner).unwrap(),
        vec![util_a, util_b, util_c]
    );
    assert_eq!(scripts::dependent_ids(&conn, util_b).unwrap(), vec![owner]);

    scripts::set_dependencies(&conn, owner, &[util_b]).unwrap();
    assert_eq!(scripts::require_ids(&conn, owner).unwrap(), vec![util_b]);
    assert_eq!(
        scripts::dependent_ids(&conn, util_a).unwrap(),
        Vec::<i64>::new()
    );
}

#[test]
fn kind_lookup_and_noop_mutations_report_expected_results() {
    let conn = open_in_memory().unwrap();
    let utility_id = scripts::create(&conn, &utility_script("Utility")).unwrap();
    let script_id = scripts::create(&conn, &normal_script("Normal")).unwrap();

    assert_eq!(
        scripts::kind_of(&conn, utility_id).unwrap(),
        Some(ScriptKind::Utility)
    );
    assert_eq!(
        scripts::kind_of(&conn, script_id).unwrap(),
        Some(ScriptKind::Normal)
    );
    assert_eq!(scripts::kind_of(&conn, 9999).unwrap(), None);

    assert!(scripts::set_kind(&conn, script_id, ScriptKind::Global).unwrap());
    assert_eq!(
        scripts::kind_of(&conn, script_id).unwrap(),
        Some(ScriptKind::Global)
    );
    assert!(!scripts::set_kind(&conn, 9999, ScriptKind::Normal).unwrap());

    assert!(!scripts::update(&conn, 9999, &normal_script("Missing")).unwrap());
    assert!(!scripts::delete(&conn, 9999).unwrap());
}

#[test]
fn get_missing_script_returns_repo_error() {
    let conn = open_in_memory().unwrap();
    let err = scripts::get(&conn, 4444).unwrap_err().to_string();
    assert!(err.contains("script 4444 not found"));
}

#[test]
fn update_and_delete_persist_repo_level_changes() {
    let conn = open_in_memory().unwrap();
    let script_id = scripts::create(&conn, &normal_script("Original")).unwrap();

    let mut updated = utility_script("Original");
    updated.description = Some("utility now".to_string());
    assert!(scripts::update(&conn, script_id, &updated).unwrap());

    let fetched = scripts::get(&conn, script_id).unwrap();
    assert_eq!(fetched.kind, ScriptKind::Utility);
    assert_eq!(fetched.description.as_deref(), Some("utility now"));
    assert_eq!(fetched.snippet.mode, PhaseMode::Inline);
    assert_eq!(fetched.before_launch.mode, PhaseMode::None);

    assert!(scripts::delete(&conn, script_id).unwrap());
    assert!(scripts::get(&conn, script_id).is_err());
}

#[test]
fn corrupt_kind_or_phase_data_surfaces_errors() {
    let conn = open_in_memory().unwrap();
    let script_id = scripts::create(&conn, &normal_script("Broken")).unwrap();
    conn.pragma_update(None, "ignore_check_constraints", "ON")
        .unwrap();

    conn.execute(
        "UPDATE scripts SET kind = 'bogus' WHERE id = ?1",
        rusqlite::params![script_id],
    )
    .unwrap();
    let invalid_kind = scripts::kind_of(&conn, script_id).unwrap_err().to_string();
    assert!(invalid_kind.contains("script"));
    assert!(invalid_kind.contains("invalid kind 'bogus'"));

    conn.execute(
        "UPDATE scripts SET kind = ?2, before_launch_mode = 'broken_mode' WHERE id = ?1",
        rusqlite::params![script_id, ScriptKind::Normal.as_db_str()],
    )
    .unwrap();
    let invalid_phase = scripts::get(&conn, script_id).unwrap_err().to_string();
    assert!(invalid_phase.contains("before_launch_mode"));

    conn.execute(
        "UPDATE scripts
         SET before_launch_mode = ?2,
             snippet_interpreter = 'broken_interpreter'
         WHERE id = ?1",
        rusqlite::params![script_id, PhaseMode::Inline.as_db_str()],
    )
    .unwrap();
    let fetched = scripts::get(&conn, script_id).unwrap();
    assert_eq!(fetched.snippet.interpreter, None);

    conn.pragma_update(None, "ignore_check_constraints", "OFF")
        .unwrap();
}
