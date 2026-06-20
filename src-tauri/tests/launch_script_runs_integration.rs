//! Launch-run ledger schema, repository, and cleanup integration tests.

use game_manager_lib::db::connection::open_in_memory;
use game_manager_lib::db::repo::{games, launch_runs, scripts, sessions};
use game_manager_lib::domain::{
    Interpreter, LaunchRunStatus, PhaseConfig, PhaseMode, Provenance, ScriptExecutionStatus,
    ScriptKind, ScriptPhase,
};

fn sample_game(name: &str) -> games::NewGame {
    games::NewGame {
        name: name.to_string(),
        launch_target: format!("C:/Games/{name}.exe"),
        monitor_mode: game_manager_lib::domain::MonitorMode::Tree,
        monitor_process_name: None,
        arguments: None,
        image_path: None,
    }
}

fn insert_game(conn: &rusqlite::Connection, name: &str) -> i64 {
    games::create(conn, &sample_game(name)).unwrap()
}

fn insert_script(conn: &rusqlite::Connection, name: &str, phase: ScriptPhase) -> i64 {
    let mut before_launch = PhaseConfig::default();
    let mut after_launch = PhaseConfig::default();
    let mut on_exit = PhaseConfig::default();
    let active_phase = PhaseConfig {
        mode: PhaseMode::Inline,
        path: None,
        inline: Some(format!("Write-Output '{name}'")),
        interpreter: Some(Interpreter::Powershell),
    };
    match phase {
        ScriptPhase::Before => before_launch = active_phase,
        ScriptPhase::After => after_launch = active_phase,
        ScriptPhase::OnExit => on_exit = active_phase,
    }

    scripts::create(
        conn,
        &scripts::NewScript {
            name: name.to_string(),
            description: None,
            kind: ScriptKind::Normal,
            priority: 5,
            before_launch,
            after_launch,
            on_exit,
            snippet: PhaseConfig::default(),
        },
    )
    .unwrap()
}

fn resolved_script(
    script_id: i64,
    name: &str,
    phase: ScriptPhase,
    provenance: Provenance,
    group_name: Option<&str>,
    order: i64,
    required_utility_names: &[&str],
) -> game_manager_lib::domain::ResolvedScript {
    game_manager_lib::domain::ResolvedScript {
        script_id,
        name: name.to_string(),
        priority: 5,
        phase,
        provenance,
        group_name: group_name.map(str::to_string),
        order,
        required_utility_names: required_utility_names
            .iter()
            .map(|name| (*name).to_string())
            .collect(),
    }
}

#[test]
fn migration_creates_launch_run_tables_and_indexes() {
    let conn = open_in_memory().unwrap();

    for expected in ["launch_runs", "launch_run_script_records"] {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [expected],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1, "missing table {expected}");
    }

    for expected in [
        "idx_launch_runs_game_started_at",
        "idx_launch_runs_play_session_id",
        "idx_launch_run_script_records_run_phase_order",
    ] {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
                [expected],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1, "missing index {expected}");
    }
}

#[test]
fn launch_run_can_be_created_populated_read_as_latest_and_linked_to_session() {
    let conn = open_in_memory().unwrap();
    let game_id = insert_game(&conn, "Alan Wake 2");
    let before_script_id = insert_script(&conn, "Auto Save", ScriptPhase::Before);
    let after_script_id = insert_script(&conn, "HDR Toggle", ScriptPhase::After);

    let run = launch_runs::create_run(&conn, game_id).unwrap();
    assert_eq!(run.game_id, game_id);
    assert_eq!(run.status, LaunchRunStatus::Active);
    assert!(run.play_session_id.is_none());
    assert!(run.script_records.is_empty());

    let seeded = launch_runs::seed_script_records(
        &conn,
        run.id,
        &[
            resolved_script(
                before_script_id,
                "Auto Save",
                ScriptPhase::Before,
                Provenance::Direct,
                None,
                1,
                &["SaveLib"],
            ),
            resolved_script(
                after_script_id,
                "HDR Toggle",
                ScriptPhase::After,
                Provenance::Group,
                Some("Display Tools"),
                1,
                &[],
            ),
        ],
    )
    .unwrap();

    assert_eq!(seeded.len(), 2);
    assert_eq!(seeded[0].phase, ScriptPhase::Before);
    assert_eq!(seeded[0].status, ScriptExecutionStatus::Pending);
    assert_eq!(
        seeded[0].required_utility_names,
        vec!["SaveLib".to_string()]
    );
    assert_eq!(seeded[1].phase, ScriptPhase::After);
    assert_eq!(seeded[1].group_name.as_deref(), Some("Display Tools"));

    assert!(launch_runs::update_script_record_status(
        &conn,
        seeded[0].id,
        ScriptExecutionStatus::Succeeded,
        Some("2026-06-19T09:00:00Z"),
        Some("2026-06-19T09:00:02Z"),
        None,
    )
    .unwrap());
    assert!(launch_runs::set_run_status(
        &conn,
        run.id,
        LaunchRunStatus::Completed,
        0,
        Some("2026-06-19T09:10:00Z"),
    )
    .unwrap());

    let session_id = sessions::insert(
        &conn,
        game_id,
        "2026-06-19T09:00:10Z",
        Some("2026-06-19T10:00:10Z"),
    )
    .unwrap();
    assert!(launch_runs::link_play_session(&conn, run.id, session_id).unwrap());

    let latest = launch_runs::get_latest_run_for_game(&conn, game_id)
        .unwrap()
        .expect("latest run");
    assert_eq!(latest.id, run.id);
    assert_eq!(latest.play_session_id, Some(session_id));
    assert_eq!(latest.status, LaunchRunStatus::Completed);
    assert_eq!(latest.failure_count, 0);
    assert_eq!(latest.script_records.len(), 2);
    assert_eq!(
        latest.script_records[0].started_at.as_deref(),
        Some("2026-06-19T09:00:00Z")
    );
    assert_eq!(
        latest.script_records[0].status,
        ScriptExecutionStatus::Succeeded
    );
}

#[test]
fn cleanup_removes_older_runs_and_cascades_their_script_records() {
    let conn = open_in_memory().unwrap();
    let game_one = insert_game(&conn, "Game One");
    let game_two = insert_game(&conn, "Game Two");
    let script_id = insert_script(&conn, "Restore HDR", ScriptPhase::OnExit);

    let old_run_one = launch_runs::create_run(&conn, game_one).unwrap();
    launch_runs::seed_script_records(
        &conn,
        old_run_one.id,
        &[resolved_script(
            script_id,
            "Restore HDR",
            ScriptPhase::OnExit,
            Provenance::Global,
            None,
            1,
            &[],
        )],
    )
    .unwrap();
    conn.execute(
        "UPDATE launch_runs SET started_at = ?2 WHERE id = ?1",
        rusqlite::params![old_run_one.id, "2026-06-18T08:00:00Z"],
    )
    .unwrap();
    launch_runs::set_run_status(
        &conn,
        old_run_one.id,
        LaunchRunStatus::Completed,
        0,
        Some("2026-06-18T09:00:00Z"),
    )
    .unwrap();

    let new_run_one = launch_runs::create_run(&conn, game_one).unwrap();
    conn.execute(
        "UPDATE launch_runs SET started_at = ?2 WHERE id = ?1",
        rusqlite::params![new_run_one.id, "2026-06-19T09:00:00Z"],
    )
    .unwrap();
    launch_runs::seed_script_records(
        &conn,
        new_run_one.id,
        &[resolved_script(
            script_id,
            "Restore HDR",
            ScriptPhase::OnExit,
            Provenance::Global,
            None,
            1,
            &[],
        )],
    )
    .unwrap();

    let old_run_two = launch_runs::create_run(&conn, game_two).unwrap();
    conn.execute(
        "UPDATE launch_runs SET started_at = ?2 WHERE id = ?1",
        rusqlite::params![old_run_two.id, "2026-06-17T09:00:00Z"],
    )
    .unwrap();
    launch_runs::seed_script_records(
        &conn,
        old_run_two.id,
        &[resolved_script(
            script_id,
            "Restore HDR",
            ScriptPhase::OnExit,
            Provenance::Direct,
            None,
            1,
            &[],
        )],
    )
    .unwrap();

    let new_run_two = launch_runs::create_run(&conn, game_two).unwrap();
    conn.execute(
        "UPDATE launch_runs SET started_at = ?2 WHERE id = ?1",
        rusqlite::params![new_run_two.id, "2026-06-20T09:00:00Z"],
    )
    .unwrap();

    let removed = launch_runs::cleanup_old_runs(&conn).unwrap();
    assert_eq!(removed, 2, "one stale run per game should be pruned");

    let remaining_runs: i64 = conn
        .query_row("SELECT COUNT(*) FROM launch_runs", [], |row| row.get(0))
        .unwrap();
    assert_eq!(remaining_runs, 2);

    let remaining_records: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM launch_run_script_records WHERE launch_run_id IN (?1, ?2)",
            rusqlite::params![old_run_one.id, old_run_two.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        remaining_records, 0,
        "stale run records must cascade-delete"
    );

    let latest_one = launch_runs::get_latest_run_for_game(&conn, game_one)
        .unwrap()
        .expect("game one latest");
    let latest_two = launch_runs::get_latest_run_for_game(&conn, game_two)
        .unwrap()
        .expect("game two latest");
    assert_eq!(latest_one.id, new_run_one.id);
    assert_eq!(latest_two.id, new_run_two.id);
}

#[test]
fn cleanup_old_runs_for_game_prunes_stale_history_immediately_after_new_snapshot_is_seeded() {
    let conn = open_in_memory().unwrap();
    let game_id = insert_game(&conn, "Alan Wake 2");
    let other_game_id = insert_game(&conn, "Control");
    let script_id = insert_script(&conn, "Restore HDR", ScriptPhase::OnExit);

    let stale_run = launch_runs::create_run(&conn, game_id).unwrap();
    conn.execute(
        "UPDATE launch_runs SET started_at = ?2 WHERE id = ?1",
        rusqlite::params![stale_run.id, "2026-06-18T08:00:00Z"],
    )
    .unwrap();
    launch_runs::seed_script_records(
        &conn,
        stale_run.id,
        &[resolved_script(
            script_id,
            "Restore HDR",
            ScriptPhase::OnExit,
            Provenance::Global,
            None,
            1,
            &[],
        )],
    )
    .unwrap();

    let other_game_run = launch_runs::create_run(&conn, other_game_id).unwrap();
    launch_runs::seed_script_records(
        &conn,
        other_game_run.id,
        &[resolved_script(
            script_id,
            "Restore HDR",
            ScriptPhase::OnExit,
            Provenance::Direct,
            None,
            1,
            &[],
        )],
    )
    .unwrap();

    let retained_run = launch_runs::create_run(&conn, game_id).unwrap();
    launch_runs::seed_script_records(
        &conn,
        retained_run.id,
        &[resolved_script(
            script_id,
            "Restore HDR",
            ScriptPhase::OnExit,
            Provenance::Global,
            None,
            1,
            &[],
        )],
    )
    .unwrap();

    let removed = launch_runs::cleanup_old_runs_for_game(&conn, game_id, retained_run.id).unwrap();
    assert_eq!(removed, 1);

    let latest = launch_runs::get_latest_run_for_game(&conn, game_id)
        .unwrap()
        .expect("latest run");
    assert_eq!(latest.id, retained_run.id);

    let stale_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM launch_runs WHERE id = ?1",
            rusqlite::params![stale_run.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stale_exists, 0);

    let stale_records: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM launch_run_script_records WHERE launch_run_id = ?1",
            rusqlite::params![stale_run.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stale_records, 0);

    let other_game_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM launch_runs WHERE id = ?1",
            rusqlite::params![other_game_run.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        other_game_exists, 1,
        "cleanup should stay scoped to one game"
    );
}

#[test]
fn missing_rows_and_empty_history_return_expected_results() {
    let conn = open_in_memory().unwrap();
    let game_id = insert_game(&conn, "Quantum Break");

    let missing_run = launch_runs::get_run(&conn, 9_999).unwrap_err().to_string();
    assert!(
        missing_run.contains("launch run 9999 not found"),
        "unexpected missing-run error: {missing_run}"
    );

    assert_eq!(
        launch_runs::get_latest_run_for_game(&conn, game_id).unwrap(),
        None
    );
    assert!(!launch_runs::link_play_session(&conn, 9_999, 1).unwrap());
    assert!(
        !launch_runs::set_run_status(&conn, 9_999, LaunchRunStatus::Cancelled, 3, None).unwrap()
    );
    assert!(!launch_runs::update_script_record_status(
        &conn,
        9_999,
        ScriptExecutionStatus::Failed,
        Some("2026-06-19T09:00:00Z"),
        Some("2026-06-19T09:00:01Z"),
        Some("boom"),
    )
    .unwrap());
    assert_eq!(launch_runs::cleanup_old_runs(&conn).unwrap(), 0);
    assert_eq!(
        launch_runs::cleanup_old_runs_for_game(&conn, game_id, 9_999).unwrap(),
        0
    );
}

#[test]
fn get_run_orders_script_records_by_phase_then_order_then_id() {
    let conn = open_in_memory().unwrap();
    let game_id = insert_game(&conn, "Control");
    let before_script_id = insert_script(&conn, "Before Second", ScriptPhase::Before);
    let on_exit_script_id = insert_script(&conn, "Exit Script", ScriptPhase::OnExit);
    let after_script_id = insert_script(&conn, "After Script", ScriptPhase::After);
    let before_first_script_id = insert_script(&conn, "Before First", ScriptPhase::Before);

    let run = launch_runs::create_run(&conn, game_id).unwrap();
    launch_runs::seed_script_records(
        &conn,
        run.id,
        &[
            resolved_script(
                before_script_id,
                "Before Second",
                ScriptPhase::Before,
                Provenance::Direct,
                None,
                2,
                &[],
            ),
            resolved_script(
                on_exit_script_id,
                "Exit Script",
                ScriptPhase::OnExit,
                Provenance::Global,
                None,
                1,
                &[],
            ),
            resolved_script(
                after_script_id,
                "After Script",
                ScriptPhase::After,
                Provenance::Group,
                Some("Automation"),
                1,
                &[],
            ),
            resolved_script(
                before_first_script_id,
                "Before First",
                ScriptPhase::Before,
                Provenance::Direct,
                None,
                1,
                &[],
            ),
        ],
    )
    .unwrap();

    let fetched = launch_runs::get_run(&conn, run.id).unwrap();
    let ordered_names: Vec<_> = fetched
        .script_records
        .iter()
        .map(|record| record.name.as_str())
        .collect();
    assert_eq!(
        ordered_names,
        vec![
            "Before First",
            "Before Second",
            "After Script",
            "Exit Script"
        ]
    );
}

#[test]
fn corrupt_persisted_launch_run_or_script_record_data_surfaces_mapping_errors() {
    let conn = open_in_memory().unwrap();
    let game_id = insert_game(&conn, "Max Payne");
    let script_id = insert_script(&conn, "Cleanup", ScriptPhase::OnExit);

    let run = launch_runs::create_run(&conn, game_id).unwrap();
    conn.pragma_update(None, "ignore_check_constraints", "ON")
        .unwrap();
    conn.execute(
        "UPDATE launch_runs SET status = 'bogus' WHERE id = ?1",
        rusqlite::params![run.id],
    )
    .unwrap();
    let invalid_status = launch_runs::get_run(&conn, run.id).unwrap_err().to_string();
    assert!(
        invalid_status.contains("invalid launch run status value 'bogus'"),
        "unexpected invalid status error: {invalid_status}"
    );

    conn.execute(
        "UPDATE launch_runs SET status = ?2 WHERE id = ?1",
        rusqlite::params![run.id, LaunchRunStatus::Active.to_string()],
    )
    .unwrap();
    let seeded = launch_runs::seed_script_records(
        &conn,
        run.id,
        &[resolved_script(
            script_id,
            "Cleanup",
            ScriptPhase::OnExit,
            Provenance::Global,
            None,
            1,
            &["NvApi"],
        )],
    )
    .unwrap();

    conn.execute(
        "UPDATE launch_run_script_records
         SET phase = 'invalid_phase',
             required_utility_names_json = 'not-json'
         WHERE id = ?1",
        rusqlite::params![seeded[0].id],
    )
    .unwrap();
    let invalid_phase = launch_runs::get_run(&conn, run.id).unwrap_err().to_string();
    assert!(
        invalid_phase.contains("invalid script phase value 'invalid_phase'"),
        "unexpected invalid phase error: {invalid_phase}"
    );

    conn.execute(
        "UPDATE launch_run_script_records
         SET phase = ?2,
             provenance = 'broken',
             required_utility_names_json = 'not-json'
         WHERE id = ?1",
        rusqlite::params![seeded[0].id, ScriptPhase::OnExit.to_string()],
    )
    .unwrap();
    let invalid_provenance = launch_runs::get_run(&conn, run.id).unwrap_err().to_string();
    assert!(
        invalid_provenance.contains("invalid script provenance value 'broken'"),
        "unexpected invalid provenance error: {invalid_provenance}"
    );

    conn.execute(
        "UPDATE launch_run_script_records
         SET provenance = ?2,
             status = 'broken',
             required_utility_names_json = '[\"NvApi\"]'
         WHERE id = ?1",
        rusqlite::params![seeded[0].id, Provenance::Global.to_string()],
    )
    .unwrap();
    let invalid_record_status = launch_runs::get_run(&conn, run.id).unwrap_err().to_string();
    assert!(
        invalid_record_status.contains("invalid script execution status value 'broken'"),
        "unexpected invalid record status error: {invalid_record_status}"
    );

    conn.execute(
        "UPDATE launch_run_script_records
         SET status = ?2,
             required_utility_names_json = 'not-json'
         WHERE id = ?1",
        rusqlite::params![seeded[0].id, ScriptExecutionStatus::Pending.to_string()],
    )
    .unwrap();
    let invalid_json = launch_runs::get_run(&conn, run.id).unwrap_err().to_string();
    assert!(
        invalid_json.contains("expected ident"),
        "unexpected invalid utility json error: {invalid_json}"
    );
    conn.pragma_update(None, "ignore_check_constraints", "OFF")
        .unwrap();
}
