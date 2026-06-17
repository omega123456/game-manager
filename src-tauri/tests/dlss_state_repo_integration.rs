//! DLSS state repository + cached-command integration tests.
//!
//! Verifies migration 003 applies cleanly and that `game_dlss_state` rows
//! round-trip (folder override + detected versions/paths + scan time) against an
//! in-memory database, plus the Phase-1 cached command surface.

use game_manager_lib::commands::dlss::{
    count_applicable_impl, get_game_state_impl, get_preset_options_impl, get_support_impl,
    list_game_states_impl, save_game_impl, set_folder_override_impl,
};
use game_manager_lib::db::connection::open_in_memory;
use game_manager_lib::db::repo::dlss as repo;
use game_manager_lib::db::repo::games::{self, NewGame};
use game_manager_lib::domain::{
    DetectedDll, DllType, GameDlssState, MonitorMode, PresetKind, SaveGameDllSelection,
    SaveGameDlss,
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

#[test]
fn migration_003_creates_the_table_and_get_is_empty() {
    let state = state();
    let game_id = seed_game(&state, "Elden Ring");
    let cached = state.with_db(|conn| repo::get(conn, game_id)).unwrap();
    assert!(cached.is_none());
}

#[test]
fn upsert_round_trips_override_and_detection() {
    let state = state();
    let game_id = seed_game(&state, "Cyberpunk");
    let row = GameDlssState {
        game_id,
        folder_override: Some("D:/Games/Cyberpunk".to_string()),
        super_resolution: Some(DetectedDll {
            version: "3.7.10".to_string(),
            path: "D:/Games/Cyberpunk/nvngx_dlss.dll".to_string(),
            md5: None,
        }),
        ray_reconstruction: Some(DetectedDll {
            version: "3.7".to_string(),
            path: "D:/Games/Cyberpunk/nvngx_dlssd.dll".to_string(),
            md5: None,
        }),
        last_scanned_at: Some("2026-06-17T12:00:00Z".to_string()),
        ..GameDlssState::default()
    };
    state.with_db(|conn| repo::upsert(conn, &row)).unwrap();

    let read = state
        .with_db(|conn| repo::get(conn, game_id))
        .unwrap()
        .expect("row exists");
    assert_eq!(read.folder_override.as_deref(), Some("D:/Games/Cyberpunk"));
    assert_eq!(read.super_resolution.unwrap().version, "3.7.10");
    assert!(read.frame_generation.is_none());
    assert_eq!(read.ray_reconstruction.unwrap().path, "D:/Games/Cyberpunk/nvngx_dlssd.dll");
    assert_eq!(read.last_scanned_at.as_deref(), Some("2026-06-17T12:00:00Z"));
}

#[test]
fn upsert_overwrites_existing_row() {
    let state = state();
    let game_id = seed_game(&state, "Game");
    let mut row = GameDlssState {
        game_id,
        folder_override: Some("A".to_string()),
        ..GameDlssState::default()
    };
    state.with_db(|conn| repo::upsert(conn, &row)).unwrap();
    row.folder_override = Some("B".to_string());
    state.with_db(|conn| repo::upsert(conn, &row)).unwrap();
    let read = state.with_db(|conn| repo::get(conn, game_id)).unwrap().unwrap();
    assert_eq!(read.folder_override.as_deref(), Some("B"));
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
fn set_folder_override_preserves_detection() {
    let state = state();
    let game_id = seed_game(&state, "Game");
    let row = GameDlssState {
        game_id,
        super_resolution: Some(DetectedDll {
            version: "3.7".to_string(),
            path: "p".to_string(),
            md5: None,
        }),
        ..GameDlssState::default()
    };
    state.with_db(|conn| repo::upsert(conn, &row)).unwrap();
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
fn list_returns_all_cached_rows_ordered() {
    let state = state();
    let a = seed_game(&state, "A");
    let b = seed_game(&state, "B");
    for id in [b, a] {
        state
            .with_db(|conn| {
                repo::upsert(
                    conn,
                    &GameDlssState {
                        game_id: id,
                        ..GameDlssState::default()
                    },
                )
            })
            .unwrap();
    }
    let states = list_game_states_impl(&state).unwrap();
    assert_eq!(states.len(), 2);
    assert!(states[0].game_id < states[1].game_id);
}

#[test]
fn count_applicable_counts_detected_per_type() {
    let state = state();
    let g1 = seed_game(&state, "One");
    let g2 = seed_game(&state, "Two");
    state
        .with_db(|conn| {
            repo::upsert(
                conn,
                &GameDlssState {
                    game_id: g1,
                    super_resolution: Some(DetectedDll {
                        version: "3.7".into(),
                        path: "p".into(),
                        md5: None,
                    }),
                    ..GameDlssState::default()
                },
            )
        })
        .unwrap();
    state
        .with_db(|conn| {
            repo::upsert(
                conn,
                &GameDlssState {
                    game_id: g2,
                    super_resolution: Some(DetectedDll {
                        version: "3.5".into(),
                        path: "q".into(),
                        md5: None,
                    }),
                    frame_generation: Some(DetectedDll {
                        version: "1.1".into(),
                        path: "r".into(),
                        md5: None,
                    }),
                    ..GameDlssState::default()
                },
            )
        })
        .unwrap();

    assert_eq!(count_applicable_impl(&state, DllType::SuperResolution).unwrap(), 2);
    assert_eq!(count_applicable_impl(&state, DllType::FrameGeneration).unwrap(), 1);
    assert_eq!(count_applicable_impl(&state, DllType::RayReconstruction).unwrap(), 0);
}

#[test]
fn deleting_a_game_cascades_to_its_dlss_state() {
    let state = state();
    let game_id = seed_game(&state, "Doomed");
    state
        .with_db(|conn| {
            repo::upsert(
                conn,
                &GameDlssState {
                    game_id,
                    ..GameDlssState::default()
                },
            )
        })
        .unwrap();
    state.with_db(|conn| games::delete(conn, game_id)).unwrap();
    let read = state.with_db(|conn| repo::get(conn, game_id)).unwrap();
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
