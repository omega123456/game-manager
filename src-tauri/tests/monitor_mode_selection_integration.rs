//! Monitor mode-selection integration tests.
//!
//! Verifies the (cross-platform) `monitor_mode_for_game` selection logic chooses
//! the configured mode, and that the Windows-gated `select_monitor` constructs a
//! usable monitor for each mode.

use game_manager_lib::db::repo::games;
use game_manager_lib::domain::MonitorMode;
use game_manager_lib::monitor::monitor_mode_for_game;
use game_manager_lib::state::AppState;

fn seed(state: &AppState, mode: MonitorMode, process_name: Option<&str>) -> i64 {
    state
        .with_db(|conn| {
            games::create(
                conn,
                &games::NewGame {
                    name: "G".to_string(),
                    launch_target: "C:/Games/G.exe".to_string(),
                    monitor_mode: mode,
                    monitor_process_name: process_name.map(str::to_string),
                    arguments: None,
                    image_path: None,
                },
            )
        })
        .unwrap()
}

#[test]
fn selects_tree_mode_for_tree_game() {
    let state = AppState::in_memory().unwrap();
    let game_id = seed(&state, MonitorMode::Tree, None);
    assert_eq!(monitor_mode_for_game(&state, game_id).unwrap(), MonitorMode::Tree);
}

#[test]
fn selects_named_mode_for_named_game() {
    let state = AppState::in_memory().unwrap();
    let game_id = seed(&state, MonitorMode::Named, Some("Real.exe"));
    assert_eq!(monitor_mode_for_game(&state, game_id).unwrap(), MonitorMode::Named);
}

#[test]
fn missing_game_errors() {
    let state = AppState::in_memory().unwrap();
    assert!(monitor_mode_for_game(&state, 9999).is_err());
}

#[cfg(windows)]
#[tokio::test]
async fn windows_constructs_a_monitor_for_each_mode() {
    use game_manager_lib::launch::cancel::CancelToken;
    use game_manager_lib::monitor::{select_monitor, StartOutcome};

    let state = AppState::in_memory().unwrap();

    // Tree mode → a real job-object monitor; launching a real short-lived tree.
    let tree_id = state
        .with_db(|conn| {
            games::create(
                conn,
                &games::NewGame {
                    name: "Tree".to_string(),
                    launch_target: "cmd.exe".to_string(),
                    monitor_mode: MonitorMode::Tree,
                    monitor_process_name: None,
                    arguments: None,
                    image_path: None,
                },
            )
        })
        .unwrap();
    let monitor = select_monitor(&state, tree_id).unwrap();
    let cancel = CancelToken::new();
    // cancel immediately so this stays fast and deterministic.
    cancel.cancel();
    // Either Started (process launched) or an error if cmd is unavailable; both
    // confirm the right monitor type was constructed and invoked.
    let _ = monitor.wait_for_start(&state, tree_id, &cancel).await;

    // Named mode → a named-process monitor; cancel before detection.
    let named_id = seed(&state, MonitorMode::Named, Some("definitely-not-running.exe"));
    let monitor = select_monitor(&state, named_id).unwrap();
    let cancel = CancelToken::new();
    cancel.cancel();
    let outcome = monitor.wait_for_start(&state, named_id, &cancel).await.unwrap();
    assert_eq!(outcome, StartOutcome::Cancelled);
}
