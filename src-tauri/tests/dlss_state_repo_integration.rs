//! DLSS state repository + cached-command integration tests.
//!
//! Verifies the `game_dlss_state` table stores only the folder override (DLSS
//! detection is session-only and held in `AppState`'s in-memory cache, never
//! persisted), that overrides round-trip against an in-memory database, and the
//! Phase-1 cached command surface that merges the two.

use std::collections::HashSet;

use game_manager_lib::commands::dlss::{
    count_applicable_impl, get_game_state_impl, get_preset_options_impl, get_support_impl,
    list_game_states_impl, save_game_impl, set_folder_override_impl,
};
use game_manager_lib::db::connection::open_in_memory;
use game_manager_lib::db::repo::dlss as repo;
use game_manager_lib::db::repo::games::{self, NewGame};
use game_manager_lib::dlss::detect::{DetectionResult, DetectionSummary};
use game_manager_lib::dlss::elevation;
use game_manager_lib::dlss::DlssError;
use game_manager_lib::domain::{
    DetectedDll, DllType, MonitorMode, PresetKind, SaveGameDllSelection, SaveGameDlss,
};
use game_manager_lib::error::AppResult;
use game_manager_lib::state::AppState;

fn state() -> AppState {
    AppState::new(open_in_memory().unwrap())
}

fn seed_game(state: &AppState, name: &str) -> i64 {
    state
        .with_db(|conn| {
            games::create(
                conn,
                &NewGame {
                    name: name.to_string(),
                    launch_target: "C:/Games/x.exe".to_string(),
                    monitor_mode: MonitorMode::Tree,
                    monitor_process_name: None,
                    arguments: None,
                    image_path: None,
                },
            )
        })
        .unwrap()
}

fn dll(version: &str, path: &str) -> DetectedDll {
    DetectedDll {
        version: version.to_string(),
        path: path.to_string(),
        md5: None,
    }
}

/// Seed a session detection result into the in-memory cache.
fn cache_detection(
    state: &AppState,
    game_id: i64,
    sr: Option<DetectedDll>,
    fg: Option<DetectedDll>,
    rr: Option<DetectedDll>,
) {
    state.dlss_detection_set(
        game_id,
        DetectionResult {
            folder_resolved: Some("D:/Games/X".to_string()),
            summary: DetectionSummary {
                super_resolution: sr,
                frame_generation: fg,
                ray_reconstruction: rr,
            },
            last_scanned_at: Some("2026-06-17T12:00:00Z".to_string()),
        },
    );
}

#[test]
fn migration_creates_the_table_and_override_is_empty() {
    let state = state();
    let game_id = seed_game(&state, "Elden Ring");
    let folder = state
        .with_db(|conn| repo::get_folder_override(conn, game_id))
        .unwrap();
    assert!(folder.is_none());
}

#[test]
fn folder_override_round_trips_in_the_db() {
    let state = state();
    let game_id = seed_game(&state, "Cyberpunk");
    state
        .with_db(|conn| repo::set_folder_override(conn, game_id, Some("D:/Games/Cyberpunk")))
        .unwrap();
    let read = state
        .with_db(|conn| repo::get_folder_override(conn, game_id))
        .unwrap();
    assert_eq!(read.as_deref(), Some("D:/Games/Cyberpunk"));
}

#[test]
fn detection_round_trips_in_the_session_cache_only() {
    let state = state();
    let game_id = seed_game(&state, "Cyberpunk");
    cache_detection(
        &state,
        game_id,
        Some(dll("3.7.10", "D:/Games/Cyberpunk/nvngx_dlss.dll")),
        None,
        Some(dll("3.7", "D:/Games/Cyberpunk/nvngx_dlssd.dll")),
    );

    // Detection is visible through the merged command read…
    let read = get_game_state_impl(&state, game_id).unwrap();
    assert!(!read.stale);
    assert_eq!(read.super_resolution.unwrap().version, "3.7.10");
    assert!(read.frame_generation.is_none());
    assert_eq!(
        read.ray_reconstruction.unwrap().path,
        "D:/Games/Cyberpunk/nvngx_dlssd.dll"
    );
    assert_eq!(
        read.last_scanned_at.as_deref(),
        Some("2026-06-17T12:00:00Z")
    );

    // …but nothing is persisted to the DB.
    assert!(state
        .with_db(|conn| repo::get_folder_override(conn, game_id))
        .unwrap()
        .is_none());
}

#[test]
fn set_folder_override_overwrites_existing_value() {
    let state = state();
    let game_id = seed_game(&state, "Game");
    state
        .with_db(|conn| repo::set_folder_override(conn, game_id, Some("A")))
        .unwrap();
    state
        .with_db(|conn| repo::set_folder_override(conn, game_id, Some("B")))
        .unwrap();
    let read = state
        .with_db(|conn| repo::get_folder_override(conn, game_id))
        .unwrap();
    assert_eq!(read.as_deref(), Some("B"));
}

#[test]
fn set_folder_override_inserts_then_clears() {
    let state = state();
    let game_id = seed_game(&state, "Game");

    let updated = set_folder_override_impl(&state, game_id, Some("D:/Games/X")).unwrap();
    assert_eq!(updated.folder_override.as_deref(), Some("D:/Games/X"));

    // Blank/whitespace clears the override.
    let cleared = set_folder_override_impl(&state, game_id, Some("   ")).unwrap();
    assert!(cleared.folder_override.is_none());
}

#[test]
fn set_folder_override_preserves_session_detection() {
    let state = state();
    let game_id = seed_game(&state, "Game");
    cache_detection(&state, game_id, Some(dll("3.7", "p")), None, None);
    let updated = set_folder_override_impl(&state, game_id, Some("D:/Z")).unwrap();
    assert!(updated.super_resolution.is_some());
    assert_eq!(updated.folder_override.as_deref(), Some("D:/Z"));
}

#[test]
fn get_game_state_returns_stale_default_when_unscanned() {
    let state = state();
    let game_id = seed_game(&state, "Fresh");
    let read = get_game_state_impl(&state, game_id).unwrap();
    assert_eq!(read.game_id, game_id);
    assert!(read.stale);
    assert!(read.super_resolution.is_none());
}

#[test]
fn list_returns_games_from_cache_and_overrides_ordered() {
    let state = state();
    let a = seed_game(&state, "A");
    let b = seed_game(&state, "B");
    // Seed in reverse id order to prove the result is sorted by game id.
    cache_detection(&state, b, Some(dll("3.7", "p")), None, None);
    state
        .with_db(|conn| repo::set_folder_override(conn, a, Some("D:/A")))
        .unwrap();
    let states = list_game_states_impl(&state).unwrap();
    assert_eq!(states.len(), 2);
    assert!(states[0].game_id < states[1].game_id);
}

#[test]
fn count_applicable_counts_detected_per_type() {
    let state = state();
    let g1 = seed_game(&state, "One");
    let g2 = seed_game(&state, "Two");
    cache_detection(&state, g1, Some(dll("3.7", "p")), None, None);
    cache_detection(
        &state,
        g2,
        Some(dll("3.5", "q")),
        Some(dll("1.1", "r")),
        None,
    );

    assert_eq!(
        count_applicable_impl(&state, DllType::SuperResolution).unwrap(),
        2
    );
    assert_eq!(
        count_applicable_impl(&state, DllType::FrameGeneration).unwrap(),
        1
    );
    assert_eq!(
        count_applicable_impl(&state, DllType::RayReconstruction).unwrap(),
        0
    );
}

#[test]
fn deleting_a_game_cascades_to_its_folder_override() {
    let state = state();
    let game_id = seed_game(&state, "Doomed");
    state
        .with_db(|conn| repo::set_folder_override(conn, game_id, Some("D:/Doomed")))
        .unwrap();
    state.with_db(|conn| games::delete(conn, game_id)).unwrap();
    let read = state
        .with_db(|conn| repo::get_folder_override(conn, game_id))
        .unwrap();
    assert!(read.is_none());
}

#[test]
fn support_reports_flags_without_panicking() {
    // On CI (no NVIDIA driver, not elevated) both are false; the call must not panic.
    let support = get_support_impl();
    let _ = support.nvapi_available;
    let _ = support.is_elevated;
}

#[test]
fn preset_options_command_returns_options() {
    let sr = get_preset_options_impl(PresetKind::Dlss).unwrap();
    assert!(!sr.is_empty());
}

#[tokio::test]
async fn save_game_persists_folder_override_even_with_unimplemented_swap() {
    // save_game applies the folder override first; with no version/preset changes
    // it returns the refreshed state without invoking the unimplemented swap.
    let state = state();
    let game_id = seed_game(&state, "Saver");
    let result = save_game_impl(
        &state,
        game_id,
        SaveGameDlss {
            folder_override: Some("D:/Games/Saver".to_string()),
            ..SaveGameDlss::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(result.folder_override.as_deref(), Some("D:/Games/Saver"));
}

#[tokio::test]
async fn save_game_with_version_change_attempts_swap() {
    // Phase 2: the swap engine is implemented. With an unresolvable launch
    // target (no real folder on the test host), the swap surfaces the
    // install-folder error rather than the Phase-1 "not yet implemented" stub.
    let state = state();
    let game_id = seed_game(&state, "WithVersion");
    let err = save_game_impl(
        &state,
        game_id,
        SaveGameDlss {
            sr: Some(SaveGameDllSelection::Version {
                version: "3.7.10".to_string(),
            }),
            ..SaveGameDlss::default()
        },
    )
    .await
    .unwrap_err();
    assert!(err.to_string().contains("install folder"));
}

#[tokio::test]
async fn save_game_fg_rr_version_changes_attempt_swap() {
    let state = state();
    let game_id = seed_game(&state, "FgRr");
    let err = save_game_impl(
        &state,
        game_id,
        SaveGameDlss {
            fg: Some(SaveGameDllSelection::Version {
                version: "1.1.0".to_string(),
            }),
            ..SaveGameDlss::default()
        },
    )
    .await
    .unwrap_err();
    assert!(err.to_string().contains("install folder"));

    let err = save_game_impl(
        &state,
        game_id,
        SaveGameDlss {
            rr: Some(SaveGameDllSelection::Version {
                version: "3.7".to_string(),
            }),
            ..SaveGameDlss::default()
        },
    )
    .await
    .unwrap_err();
    assert!(err.to_string().contains("install folder"));
}

#[tokio::test]
async fn save_game_preset_changes_route_through_nvapi() {
    // Phase 3: preset branches now go through NVAPI. With no NVIDIA driver/profile
    // present (CI / coverage) the call gracefully returns `unsupported` (or a
    // no-op success on a real GPU) — never "not yet implemented", never a panic.
    let state = state();
    let game_id = seed_game(&state, "Presets");

    let assert_routed = |result: AppResult<_>| match result {
        Ok(_) => {}
        Err(err) => {
            let message = err.to_string();
            assert!(
                !message.contains("not yet implemented"),
                "preset save should no longer be unimplemented: {message}"
            );
        }
    };

    // No DLL changes → reaches the SR preset branch.
    assert_routed(
        save_game_impl(
            &state,
            game_id,
            SaveGameDlss {
                sr_preset: Some(4),
                ..SaveGameDlss::default()
            },
        )
        .await,
    );

    assert_routed(
        save_game_impl(
            &state,
            game_id,
            SaveGameDlss {
                rr_preset: Some(5),
                ..SaveGameDlss::default()
            },
        )
        .await,
    );
}

#[test]
fn folder_override_command_round_trips_with_none() {
    // Passing None leaves the override clear and returns a stale default state.
    let state = state();
    let game_id = seed_game(&state, "NoneOverride");
    let result = set_folder_override_impl(&state, game_id, None).unwrap();
    assert!(result.folder_override.is_none());
}

#[test]
fn relaunch_as_admin_reports_unsupported_in_test_builds() {
    let err = elevation::relaunch_as_admin().unwrap_err();
    assert!(matches!(err, DlssError::Unsupported));
}

#[test]
fn dlss_detection_cache_retain_remove_and_snapshot() {
    let state = state();
    let keep_id = seed_game(&state, "Keep");
    let drop_id = seed_game(&state, "Drop");
    let remove_id = seed_game(&state, "Remove");

    cache_detection(&state, keep_id, Some(dll("3.7", "a")), None, None);
    cache_detection(&state, drop_id, Some(dll("3.7", "b")), None, None);
    cache_detection(&state, remove_id, Some(dll("3.7", "c")), None, None);

    state.dlss_detection_remove(remove_id);
    assert!(state.dlss_detection_get(remove_id).is_none());

    let live = HashSet::from([keep_id]);
    state.dlss_detection_retain(&live);

    let snapshot = state.dlss_detection_snapshot();
    assert_eq!(snapshot.len(), 1);
    assert_eq!(snapshot[0].0, keep_id);
    assert!(state.dlss_detection_get(drop_id).is_none());
}

#[test]
fn dlss_detection_set_tolerates_poisoned_cache_mutex() {
    let state = state();
    let game_id = seed_game(&state, "Poisoned");
    cache_detection(&state, game_id, Some(dll("3.7", "x")), None, None);
    assert!(state.dlss_detection_get(game_id).is_some());

    state.poison_dlss_detection_mutex_for_test();
    cache_detection(&state, game_id, Some(dll("3.8", "y")), None, None);
    assert!(state.dlss_detection_get(game_id).is_none());
}

#[test]
fn dlss_detection_retain_noops_when_cache_mutex_is_poisoned() {
    let state = state();
    let game_id = seed_game(&state, "Retain");
    cache_detection(&state, game_id, Some(dll("3.7", "x")), None, None);
    state.poison_dlss_detection_mutex_for_test();
    state.dlss_detection_retain(&HashSet::from([game_id]));
    assert!(state.dlss_detection_get(game_id).is_none());
}
