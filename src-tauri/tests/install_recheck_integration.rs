//! Install-state commands (`commands::install`) and their hooks in game
//! create/update and Play Now, driven through a fake install probe.

use std::io;
use std::time::Duration;

use game_manager_lib::commands::games::{
    create_game_impl, get_game_impl, get_play_now_game_impl, update_game_impl,
    update_game_tracked_impl, GameUpsertInput,
};
use game_manager_lib::commands::install::{
    check_install_now_impl, ensure_launchable_impl, recheck_installs_impl,
};
use game_manager_lib::db::repo::{games, sessions, settings};
use game_manager_lib::dlss::detect::DetectionResult;
use game_manager_lib::domain::{MissingReason, MonitorMode};
use game_manager_lib::state::AppState;

mod common;
use common::{state_with_probe, FakeInstallProbe};

const PRESENT: &str = r"C:\Games\Present\present.exe";
const GONE: &str = r"C:\Games\Gone\gone.exe";
const OFFLINE: &str = r"Q:\Games\Offline\offline.exe";

fn input(name: &str, launch_target: &str) -> GameUpsertInput {
    GameUpsertInput {
        name: name.to_string(),
        launch_target: launch_target.to_string(),
        monitor_mode: MonitorMode::Tree,
        monitor_process_name: None,
        arguments: None,
        image_path: None,
    }
}

/// Insert a game directly (no install check) so tests control its stored state.
fn insert(state: &AppState, name: &str, launch_target: &str) -> i64 {
    state
        .with_db(|conn| {
            let mut game = common::new_game(launch_target);
            game.name = name.to_string();
            games::create(conn, &game)
        })
        .unwrap()
}

fn reason(state: &AppState, id: i64) -> Option<MissingReason> {
    get_game_impl(state, id).unwrap().missing_reason
}

fn cache_detection(state: &AppState, game_id: i64) {
    state.dlss_detection_set(game_id, DetectionResult::default());
}

#[test]
fn recheck_marks_file_and_drive_misses_and_keeps_present_games() {
    let probe = FakeInstallProbe::with_present(&[PRESENT]);
    probe.set_root_missing(r"Q:\");
    let state = state_with_probe(&probe);
    let present = insert(&state, "Present", PRESENT);
    let gone = insert(&state, "Gone", GONE);
    let offline = insert(&state, "Offline", OFFLINE);
    let uri = insert(&state, "Store", "steam://rungameid/1");

    let summary = recheck_installs_impl(&state, Duration::ZERO).unwrap();

    assert_eq!(summary.checked, 4);
    assert_eq!(summary.missing_game_ids, vec![gone, offline]);
    assert_eq!(summary.changed_game_ids, vec![gone, offline]);
    assert!(summary.restored_game_ids.is_empty());
    assert_eq!(reason(&state, present), None);
    assert_eq!(reason(&state, gone), Some(MissingReason::FileMissing));
    assert_eq!(reason(&state, offline), Some(MissingReason::DriveMissing));
    assert_eq!(reason(&state, uri), None);

    let present_game = get_game_impl(&state, present).unwrap();
    assert!(present_game.last_seen_installed_at.is_some());
    assert!(get_game_impl(&state, uri)
        .unwrap()
        .last_seen_installed_at
        .is_none());
    assert!(get_game_impl(&state, gone)
        .unwrap()
        .last_seen_installed_at
        .is_none());
}

#[test]
fn a_single_miss_followed_by_a_hit_keeps_the_game_installed() {
    let probe = FakeInstallProbe::with_present(&[PRESENT]);
    probe.script(PRESENT, vec![Err(io::ErrorKind::NotFound)]);
    let state = state_with_probe(&probe);
    let id = insert(&state, "Waking drive", PRESENT);

    let summary = recheck_installs_impl(&state, Duration::from_millis(1)).unwrap();

    assert!(summary.missing_game_ids.is_empty());
    assert!(summary.changed_game_ids.is_empty());
    assert_eq!(reason(&state, id), None);
    assert_eq!(probe.stat_calls(), 2);
}

#[test]
fn recheck_restores_games_whose_target_came_back() {
    let probe = FakeInstallProbe::with_present(&[]);
    let state = state_with_probe(&probe);
    let id = insert(&state, "Reinstalled", GONE);
    recheck_installs_impl(&state, Duration::ZERO).unwrap();
    assert_eq!(reason(&state, id), Some(MissingReason::FileMissing));

    probe.set_present(GONE, true);
    let summary = recheck_installs_impl(&state, Duration::ZERO).unwrap();

    assert_eq!(summary.changed_game_ids, vec![id]);
    assert_eq!(summary.restored_game_ids, vec![id]);
    assert!(summary.missing_game_ids.is_empty());
    assert_eq!(reason(&state, id), None);
}

#[test]
fn recheck_reports_a_file_to_drive_change_without_restoring() {
    let probe = FakeInstallProbe::with_present(&[]);
    let state = state_with_probe(&probe);
    let id = insert(&state, "Moved drive", OFFLINE);
    recheck_installs_impl(&state, Duration::ZERO).unwrap();
    assert_eq!(reason(&state, id), Some(MissingReason::FileMissing));

    probe.set_root_missing(r"Q:\");
    let summary = recheck_installs_impl(&state, Duration::ZERO).unwrap();

    assert_eq!(summary.changed_game_ids, vec![id]);
    assert!(summary.restored_game_ids.is_empty());
    assert_eq!(reason(&state, id), Some(MissingReason::DriveMissing));
}

#[test]
fn unverifiable_targets_keep_their_stored_state() {
    let probe = FakeInstallProbe::with_present(&[]);
    let state = state_with_probe(&probe);
    let missing = insert(&state, "Missing", GONE);
    let installed = insert(&state, "Installed", PRESENT);
    probe.set_present(PRESENT, true);
    recheck_installs_impl(&state, Duration::ZERO).unwrap();

    probe.script(GONE, vec![Err(io::ErrorKind::PermissionDenied)]);
    probe.script(PRESENT, vec![Err(io::ErrorKind::PermissionDenied)]);
    let summary = recheck_installs_impl(&state, Duration::ZERO).unwrap();

    assert_eq!(summary.missing_game_ids, vec![missing]);
    assert!(summary.changed_game_ids.is_empty());
    assert_eq!(reason(&state, missing), Some(MissingReason::FileMissing));
    assert_eq!(reason(&state, installed), None);
}

#[test]
fn recheck_drops_dlss_detection_for_games_that_went_missing() {
    let probe = FakeInstallProbe::with_present(&[PRESENT]);
    let state = state_with_probe(&probe);
    let kept = insert(&state, "Kept", PRESENT);
    let gone = insert(&state, "Gone", GONE);
    cache_detection(&state, kept);
    cache_detection(&state, gone);

    recheck_installs_impl(&state, Duration::ZERO).unwrap();

    assert!(state.dlss_detection_get(kept).is_some());
    assert!(state.dlss_detection_get(gone).is_none());
}

#[test]
fn install_writes_skip_games_relinked_during_the_check() {
    let state = AppState::in_memory().unwrap();
    let id = insert(&state, "Relinked", GONE);
    state
        .with_db(|conn| {
            conn.execute(
                "UPDATE games SET launch_target = ?1 WHERE id = ?2",
                rusqlite::params![PRESENT, id],
            )?;
            Ok(())
        })
        .unwrap();

    let written = state
        .with_db(|conn| {
            games::apply_install_statuses(
                conn,
                &[games::InstallUpdate {
                    id,
                    launch_target: GONE.to_string(),
                    missing_reason: Some(MissingReason::FileMissing),
                    seen_at: None,
                }],
            )
        })
        .unwrap();

    assert!(written.is_empty());
    assert_eq!(reason(&state, id), None);
}

#[test]
fn ensure_launchable_passes_for_present_and_non_path_targets() {
    let probe = FakeInstallProbe::with_present(&[PRESENT]);
    let state = state_with_probe(&probe);
    let present = insert(&state, "Present", PRESENT);
    let uri = insert(&state, "Store", "steam://rungameid/1");

    ensure_launchable_impl(&state, present, Duration::ZERO).unwrap();
    ensure_launchable_impl(&state, uri, Duration::ZERO).unwrap();

    assert!(get_game_impl(&state, present)
        .unwrap()
        .last_seen_installed_at
        .is_some());
}

#[test]
fn ensure_launchable_records_a_missing_file_and_names_it() {
    let probe = FakeInstallProbe::with_present(&[]);
    let state = state_with_probe(&probe);
    let id = insert(&state, "Control", GONE);
    cache_detection(&state, id);

    let err = ensure_launchable_impl(&state, id, Duration::ZERO).unwrap_err();

    assert_eq!(
        err.to_string(),
        format!("Control isn't installed: launch target not found ({GONE}).")
    );
    assert_eq!(reason(&state, id), Some(MissingReason::FileMissing));
    assert!(state.dlss_detection_get(id).is_none());
}

#[test]
fn ensure_launchable_names_a_disconnected_drive() {
    let probe = FakeInstallProbe::with_present(&[]);
    probe.set_root_missing(r"Q:\");
    let state = state_with_probe(&probe);
    let id = insert(&state, "Offline", OFFLINE);

    let err = ensure_launchable_impl(&state, id, Duration::ZERO).unwrap_err();

    assert_eq!(
        err.to_string(),
        "Offline isn't installed: drive Q: isn't connected."
    );
    assert_eq!(reason(&state, id), Some(MissingReason::DriveMissing));
}

#[test]
fn ensure_launchable_clears_a_stale_flag() {
    let probe = FakeInstallProbe::with_present(&[]);
    let state = state_with_probe(&probe);
    let id = insert(&state, "Back", GONE);
    recheck_installs_impl(&state, Duration::ZERO).unwrap();
    probe.set_present(GONE, true);

    ensure_launchable_impl(&state, id, Duration::ZERO).unwrap();

    assert_eq!(reason(&state, id), None);
}

#[test]
fn ensure_launchable_leaves_state_alone_when_unverifiable() {
    let probe = FakeInstallProbe::with_present(&[]);
    let state = state_with_probe(&probe);
    let id = insert(&state, "Locked", GONE);
    probe.script(GONE, vec![Err(io::ErrorKind::PermissionDenied)]);

    ensure_launchable_impl(&state, id, Duration::ZERO).unwrap();

    assert_eq!(reason(&state, id), None);
}

#[test]
fn install_checks_reject_unknown_games() {
    let state = AppState::in_memory().unwrap();
    assert_eq!(
        ensure_launchable_impl(&state, 404, Duration::ZERO)
            .unwrap_err()
            .to_string(),
        "game 404 not found"
    );
    assert_eq!(
        check_install_now_impl(&state, 404).unwrap_err().to_string(),
        "game 404 not found"
    );
}

#[test]
fn create_checks_the_new_target_immediately() {
    let probe = FakeInstallProbe::with_present(&[PRESENT]);
    let state = state_with_probe(&probe);

    let installed = create_game_impl(&state, input("Present", PRESENT)).unwrap();
    let missing = create_game_impl(&state, input("Gone", GONE)).unwrap();

    assert_eq!(installed.missing_reason, None);
    assert!(installed.last_seen_installed_at.is_some());
    assert_eq!(missing.missing_reason, Some(MissingReason::FileMissing));
    assert_eq!(
        probe.stat_calls(),
        2,
        "the immediate check has no grace re-probe"
    );
}

#[test]
fn update_only_checks_when_the_target_changes() {
    let probe = FakeInstallProbe::with_present(&[]);
    let state = state_with_probe(&probe);
    let game = create_game_impl(&state, input("Autosaved", GONE)).unwrap();
    assert_eq!(probe.stat_calls(), 1);

    let (renamed, changed) =
        update_game_tracked_impl(&state, game.id, input("Renamed", GONE)).unwrap();
    assert!(!changed);
    assert_eq!(probe.stat_calls(), 1);
    assert_eq!(renamed.missing_reason, Some(MissingReason::FileMissing));

    probe.set_present(PRESENT, true);
    let (relinked, changed) =
        update_game_tracked_impl(&state, game.id, input("Renamed", PRESENT)).unwrap();
    assert!(changed);
    assert_eq!(relinked.missing_reason, None);
    assert!(relinked.last_seen_installed_at.is_some());
}

#[test]
fn update_to_a_non_path_target_clears_the_flag() {
    let probe = FakeInstallProbe::with_present(&[]);
    let state = state_with_probe(&probe);
    let game = create_game_impl(&state, input("Moved to Steam", GONE)).unwrap();
    assert!(game.missing_reason.is_some());

    let updated = update_game_impl(
        &state,
        game.id,
        input("Moved to Steam", "steam://rungameid/9"),
    )
    .unwrap();

    assert_eq!(updated.missing_reason, None);
    assert_eq!(probe.stat_calls(), 1);
}

#[test]
fn unc_targets_are_optimistic_on_save_and_verified_by_recheck() {
    let probe = FakeInstallProbe::with_present(&[]);
    let state = state_with_probe(&probe);
    let unc = r"\\nas\games\x.exe";

    let game = create_game_impl(&state, input("On the NAS", unc)).unwrap();
    assert_eq!(game.missing_reason, None);
    assert!(game.last_seen_installed_at.is_none());
    assert_eq!(probe.stat_calls(), 0);

    recheck_installs_impl(&state, Duration::ZERO).unwrap();
    assert_eq!(reason(&state, game.id), Some(MissingReason::FileMissing));
}

#[test]
fn update_keeps_the_not_found_error_for_unknown_games() {
    let state = state_with_probe(&FakeInstallProbe::all_present());
    let err = update_game_impl(&state, 9999, input("Nope", PRESENT)).unwrap_err();
    assert_eq!(err.to_string(), "game 9999 not found");
}

#[test]
fn play_now_skips_games_that_are_not_installed() {
    let probe = FakeInstallProbe::with_present(&[PRESENT]);
    let state = state_with_probe(&probe);
    let installed = insert(&state, "Installed", PRESENT);
    let gone = insert(&state, "Gone", GONE);
    state
        .with_db(|conn| {
            sessions::insert(
                conn,
                installed,
                "2026-06-10T20:00:00+00:00",
                Some("2026-06-10T21:00:00+00:00"),
            )?;
            sessions::insert(
                conn,
                gone,
                "2026-06-11T20:00:00+00:00",
                Some("2026-06-11T21:00:00+00:00"),
            )?;
            settings::set(conn, "last_played_game_id", &gone.to_string())
        })
        .unwrap();

    assert_eq!(get_play_now_game_impl(&state).unwrap().unwrap().id, gone);

    recheck_installs_impl(&state, Duration::ZERO).unwrap();

    assert_eq!(
        get_play_now_game_impl(&state).unwrap().unwrap().id,
        installed
    );
}

#[test]
fn install_targets_are_listed_with_their_stored_state() {
    let probe = FakeInstallProbe::with_present(&[]);
    let state = state_with_probe(&probe);
    let id = insert(&state, "Listed", GONE);
    recheck_installs_impl(&state, Duration::ZERO).unwrap();

    let targets = state.with_db(games::install_targets).unwrap();
    assert_eq!(targets.len(), 1);
    assert_eq!(targets[0].id, id);
    assert_eq!(targets[0].name, "Listed");
    assert_eq!(targets[0].launch_target, GONE);
    assert_eq!(targets[0].missing_reason, Some(MissingReason::FileMissing));
    assert_eq!(
        state
            .with_db(|conn| games::install_target(conn, 999))
            .unwrap(),
        None
    );
}
