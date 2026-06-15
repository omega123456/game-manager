//! Scripts command (`*_impl`) integration tests against an in-memory DB.
//!
//! Covers CRUD for both shapes (normal/global phases + utility snippet),
//! phase/interpreter and snippet persistence, the kind-dependent
//! mutual-exclusivity normalization, `set_script_kind`, the require-target
//! must-be-utility rule, and DFS cycle detection (direct + transitive).

use game_manager_lib::commands::scripts::{
    create_script_impl, delete_script_impl, get_script_impl, list_scripts_impl,
    set_script_dependencies_impl, set_script_kind_impl, update_script_impl, PhaseInput,
    ScriptUpsertInput,
};
use game_manager_lib::domain::{Interpreter, PhaseMode, ScriptKind};
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

fn path_phase(path: &str) -> PhaseInput {
    PhaseInput {
        mode: PhaseMode::Path,
        path: Some(path.to_string()),
        inline: None,
        interpreter: None,
    }
}

fn normal_input(name: &str) -> ScriptUpsertInput {
    ScriptUpsertInput {
        name: name.to_string(),
        description: Some("  a normal script  ".to_string()),
        kind: ScriptKind::Normal,
        priority: 7,
        before_launch: inline_phase("Write-Host before"),
        after_launch: path_phase("C:/Commands/after.ps1"),
        on_exit: none_phase(),
        snippet: none_phase(),
    }
}

fn utility_input(name: &str) -> ScriptUpsertInput {
    ScriptUpsertInput {
        name: name.to_string(),
        description: None,
        kind: ScriptKind::Utility,
        priority: 5,
        before_launch: none_phase(),
        after_launch: none_phase(),
        on_exit: none_phase(),
        snippet: inline_phase("function Helper {}"),
    }
}

#[test]
fn create_normal_script_persists_phases_and_interpreter() {
    let state = state();
    let created = create_script_impl(&state, normal_input("FPS Unlocker")).unwrap();

    assert_eq!(created.name, "FPS Unlocker");
    assert_eq!(created.description.as_deref(), Some("a normal script"));
    assert_eq!(created.kind, ScriptKind::Normal);
    assert_eq!(created.priority, 7);

    assert_eq!(created.before_launch.mode, PhaseMode::Inline);
    assert_eq!(created.before_launch.inline.as_deref(), Some("Write-Host before"));
    assert_eq!(created.before_launch.interpreter, Some(Interpreter::Powershell));

    assert_eq!(created.after_launch.mode, PhaseMode::Path);
    assert_eq!(created.after_launch.path.as_deref(), Some("C:/Commands/after.ps1"));

    assert_eq!(created.on_exit.mode, PhaseMode::None);
    // Snippet is cleared for normal/global.
    assert_eq!(created.snippet.mode, PhaseMode::None);
    assert!(created.requires.is_empty());

    let fetched = get_script_impl(&state, created.id).unwrap();
    assert_eq!(fetched, created);
}

#[test]
fn create_utility_script_persists_snippet_and_clears_phases() {
    let state = state();
    let created = create_script_impl(&state, utility_input("SaveLib")).unwrap();

    assert_eq!(created.kind, ScriptKind::Utility);
    assert_eq!(created.snippet.mode, PhaseMode::Inline);
    assert_eq!(created.snippet.inline.as_deref(), Some("function Helper {}"));
    assert_eq!(created.snippet.interpreter, Some(Interpreter::Powershell));
    assert_eq!(created.before_launch.mode, PhaseMode::None);
    assert_eq!(created.after_launch.mode, PhaseMode::None);
    assert_eq!(created.on_exit.mode, PhaseMode::None);
}

#[test]
fn utility_input_with_phases_set_still_clears_them() {
    // The frontend may carry both column groups; normalization must drop the
    // inactive one so the schema CHECKs hold.
    let state = state();
    let mut input = utility_input("MixedShape");
    input.before_launch = inline_phase("Write-Host phase");
    let created = create_script_impl(&state, input).unwrap();
    assert_eq!(created.before_launch.mode, PhaseMode::None);
    assert_eq!(created.snippet.mode, PhaseMode::Inline);
}

#[test]
fn global_script_keeps_phases_and_clears_snippet() {
    let state = state();
    let mut input = normal_input("HDR Toggle");
    input.kind = ScriptKind::Global;
    input.snippet = inline_phase("should be dropped");
    let created = create_script_impl(&state, input).unwrap();
    assert_eq!(created.kind, ScriptKind::Global);
    assert_eq!(created.before_launch.mode, PhaseMode::Inline);
    assert_eq!(created.snippet.mode, PhaseMode::None);
}

#[test]
fn update_and_list_round_trip() {
    let state = state();
    let created = create_script_impl(&state, normal_input("A")).unwrap();

    let mut update = normal_input("Renamed");
    update.priority = 3;
    update.before_launch = none_phase();
    update.on_exit = inline_phase("Write-Host bye");
    let updated = update_script_impl(&state, created.id, update).unwrap();
    assert_eq!(updated.name, "Renamed");
    assert_eq!(updated.priority, 3);
    assert_eq!(updated.before_launch.mode, PhaseMode::None);
    assert_eq!(updated.on_exit.mode, PhaseMode::Inline);

    let listed = list_scripts_impl(&state).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "Renamed");
}

#[test]
fn empty_name_is_rejected() {
    let state = state();
    let mut input = normal_input("   ");
    input.name = "   ".to_string();
    let err = create_script_impl(&state, input).expect_err("blank name");
    assert_eq!(err.to_string(), "script name is required");
}

#[test]
fn priority_out_of_range_is_rejected() {
    let state = state();
    let mut input = normal_input("Bad");
    input.priority = 0;
    let err = create_script_impl(&state, input).expect_err("priority");
    assert_eq!(err.to_string(), "priority must be between 1 and 10");

    let mut high = normal_input("Bad2");
    high.priority = 11;
    let err = create_script_impl(&state, high).expect_err("priority");
    assert_eq!(err.to_string(), "priority must be between 1 and 10");
}

#[test]
fn empty_inline_code_collapses_to_none() {
    let state = state();
    let mut empty_code = normal_input("EmptyCode");
    empty_code.before_launch = PhaseInput {
        mode: PhaseMode::Inline,
        path: None,
        inline: Some("   ".to_string()),
        interpreter: Some(Interpreter::Powershell),
    };
    let created = create_script_impl(&state, empty_code).expect("whitespace inline is ignored");
    assert_eq!(created.before_launch.mode, PhaseMode::None);
}

#[test]
fn inline_mode_with_code_requires_interpreter() {
    let state = state();
    let mut missing_interp = normal_input("NoInterp");
    missing_interp.before_launch = PhaseInput {
        mode: PhaseMode::Inline,
        path: None,
        inline: Some("code".to_string()),
        interpreter: None,
    };
    let err = create_script_impl(&state, missing_interp).expect_err("interp");
    assert!(err.to_string().contains("interpreter is required for inline mode"));
}

#[test]
fn empty_path_collapses_to_none() {
    let state = state();
    let mut input = normal_input("NoPath");
    input.after_launch = PhaseInput {
        mode: PhaseMode::Path,
        path: Some("  ".to_string()),
        inline: None,
        interpreter: None,
    };
    let created = create_script_impl(&state, input).expect("whitespace path is ignored");
    assert_eq!(created.after_launch.mode, PhaseMode::None);
}

#[test]
fn delete_script_removes_it_and_errors_when_missing() {
    let state = state();
    let created = create_script_impl(&state, normal_input("Temp")).unwrap();
    delete_script_impl(&state, created.id).unwrap();
    assert!(get_script_impl(&state, created.id).is_err());

    let err = delete_script_impl(&state, 4242).expect_err("missing");
    assert_eq!(err.to_string(), "script 4242 not found");
}

#[test]
fn update_missing_script_errors() {
    let state = state();
    let err = update_script_impl(&state, 9, normal_input("X")).expect_err("missing");
    assert_eq!(err.to_string(), "script 9 not found");
}

#[test]
fn set_script_kind_normalizes_shape() {
    let state = state();
    let created = create_script_impl(&state, normal_input("Switchable")).unwrap();
    assert_eq!(created.before_launch.mode, PhaseMode::Inline);

    // Normal -> Utility clears the phases.
    let to_utility = set_script_kind_impl(&state, created.id, ScriptKind::Utility).unwrap();
    assert_eq!(to_utility.kind, ScriptKind::Utility);
    assert_eq!(to_utility.before_launch.mode, PhaseMode::None);
    assert_eq!(to_utility.after_launch.mode, PhaseMode::None);

    // Utility -> Global keeps the (now-empty) snippet cleared.
    let to_global = set_script_kind_impl(&state, created.id, ScriptKind::Global).unwrap();
    assert_eq!(to_global.kind, ScriptKind::Global);
    assert_eq!(to_global.snippet.mode, PhaseMode::None);
}

#[test]
fn set_script_kind_errors_when_missing() {
    let state = state();
    let err = set_script_kind_impl(&state, 77, ScriptKind::Global).expect_err("missing");
    assert!(err.to_string().contains("not found"));
}

#[test]
fn dependencies_must_target_utility_scripts() {
    let state = state();
    let normal = create_script_impl(&state, normal_input("Requirer")).unwrap();
    let other_normal = create_script_impl(&state, normal_input("Target")).unwrap();

    let err = set_script_dependencies_impl(&state, normal.id, vec![other_normal.id])
        .expect_err("non-utility target");
    assert!(err
        .to_string()
        .contains("require edges may only target utility scripts"));
}

#[test]
fn set_script_kind_rejects_reclassifying_utility_with_dependents() {
    let state = state();
    let requirer = create_script_impl(&state, normal_input("Requirer")).unwrap();
    let util = create_script_impl(&state, utility_input("Required")).unwrap();
    set_script_dependencies_impl(&state, requirer.id, vec![util.id]).unwrap();

    let err = set_script_kind_impl(&state, util.id, ScriptKind::Normal)
        .expect_err("utility with dependents");
    assert!(err
        .to_string()
        .contains("cannot change this utility to normal"));
    assert!(err.to_string().contains("1 script(s) still require it"));

    // The utility's kind is unchanged after rejection.
    let reloaded = get_script_impl(&state, util.id).unwrap();
    assert_eq!(reloaded.kind, ScriptKind::Utility);
}

#[test]
fn set_script_kind_rejects_reclassifying_utility_to_global_with_dependents() {
    let state = state();
    let requirer = create_script_impl(&state, normal_input("Requirer")).unwrap();
    let util = create_script_impl(&state, utility_input("Required")).unwrap();
    set_script_dependencies_impl(&state, requirer.id, vec![util.id]).unwrap();

    // The guard rejects every non-utility target, not just `normal`.
    let err = set_script_kind_impl(&state, util.id, ScriptKind::Global)
        .expect_err("utility with dependents");
    assert!(err
        .to_string()
        .contains("cannot change this utility to global"));
    assert!(err.to_string().contains("1 script(s) still require it"));

    // The utility's kind is unchanged after rejection.
    let reloaded = get_script_impl(&state, util.id).unwrap();
    assert_eq!(reloaded.kind, ScriptKind::Utility);
}

#[test]
fn update_script_rejects_flipping_utility_with_dependents_to_normal() {
    let state = state();
    let requirer = create_script_impl(&state, normal_input("Requirer")).unwrap();
    let util = create_script_impl(&state, utility_input("Required")).unwrap();
    set_script_dependencies_impl(&state, requirer.id, vec![util.id]).unwrap();

    // Flip the utility to normal via update_script — same rejection must apply.
    let flip = normal_input("Required");
    let err = update_script_impl(&state, util.id, flip).expect_err("utility with dependents");
    assert!(err
        .to_string()
        .contains("cannot change this utility to normal"));

    let reloaded = get_script_impl(&state, util.id).unwrap();
    assert_eq!(reloaded.kind, ScriptKind::Utility);
}

#[test]
fn reclassifying_utility_without_dependents_succeeds() {
    let state = state();
    let util = create_script_impl(&state, utility_input("Lonely")).unwrap();

    // No inbound require edges -> the transition is allowed.
    let to_normal = set_script_kind_impl(&state, util.id, ScriptKind::Normal).unwrap();
    assert_eq!(to_normal.kind, ScriptKind::Normal);

    // Via update_script as well.
    let again = create_script_impl(&state, utility_input("Lonely2")).unwrap();
    let updated = update_script_impl(&state, again.id, normal_input("Lonely2")).unwrap();
    assert_eq!(updated.kind, ScriptKind::Normal);
}

#[test]
fn non_utility_kind_change_is_unaffected_by_guard() {
    let state = state();
    // A normal script can never have inbound require edges, so normal -> global
    // is never blocked by the guard.
    let created = create_script_impl(&state, normal_input("Normalish")).unwrap();
    let to_global = set_script_kind_impl(&state, created.id, ScriptKind::Global).unwrap();
    assert_eq!(to_global.kind, ScriptKind::Global);
}

#[test]
fn dependencies_persist_and_dedupe() {
    let state = state();
    let requirer = create_script_impl(&state, normal_input("Requirer")).unwrap();
    let util_a = create_script_impl(&state, utility_input("A")).unwrap();
    let util_b = create_script_impl(&state, utility_input("B")).unwrap();

    let saved = set_script_dependencies_impl(
        &state,
        requirer.id,
        vec![util_a.id, util_b.id, util_a.id],
    )
    .unwrap();
    assert_eq!(saved.len(), 2);
    assert!(saved.contains(&util_a.id));
    assert!(saved.contains(&util_b.id));

    let hydrated = get_script_impl(&state, requirer.id).unwrap();
    assert_eq!(hydrated.requires.len(), 2);
}

#[test]
fn direct_self_cycle_is_rejected() {
    let state = state();
    let util = create_script_impl(&state, utility_input("SelfRef")).unwrap();
    let err = set_script_dependencies_impl(&state, util.id, vec![util.id])
        .expect_err("self cycle");
    assert!(err.to_string().contains("circular reference"));
}

#[test]
fn transitive_cycle_is_rejected() {
    let state = state();
    // Build A -> B -> C, then attempt C -> A which closes a cycle.
    let a = create_script_impl(&state, utility_input("A")).unwrap();
    let b = create_script_impl(&state, utility_input("B")).unwrap();
    let c = create_script_impl(&state, utility_input("C")).unwrap();

    set_script_dependencies_impl(&state, a.id, vec![b.id]).unwrap();
    set_script_dependencies_impl(&state, b.id, vec![c.id]).unwrap();

    let err =
        set_script_dependencies_impl(&state, c.id, vec![a.id]).expect_err("transitive cycle");
    assert!(err.to_string().contains("circular reference"));

    // The valid chain (no closing edge) is accepted.
    let d = create_script_impl(&state, utility_input("D")).unwrap();
    set_script_dependencies_impl(&state, c.id, vec![d.id]).unwrap();
    assert_eq!(get_script_impl(&state, c.id).unwrap().requires, vec![d.id]);
}

#[test]
fn set_dependencies_on_missing_script_errors() {
    let state = state();
    let util = create_script_impl(&state, utility_input("U")).unwrap();
    let err = set_script_dependencies_impl(&state, 555, vec![util.id]).expect_err("missing owner");
    assert!(err.to_string().contains("not found"));
}

#[test]
fn dependency_target_must_exist() {
    let state = state();
    let requirer = create_script_impl(&state, normal_input("Requirer")).unwrap();
    let err =
        set_script_dependencies_impl(&state, requirer.id, vec![9999]).expect_err("missing target");
    assert!(err.to_string().contains("not found"));
}
