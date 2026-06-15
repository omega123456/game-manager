//! Settings command (`*_impl`) integration tests against an in-memory DB.

use game_manager_lib::commands::settings::{
    get_all_settings_impl, get_setting_impl, set_setting_impl,
};
use game_manager_lib::db::connection::open_in_memory;
use game_manager_lib::state::AppState;

fn state() -> AppState {
    AppState::new(open_in_memory().unwrap())
}

#[test]
fn set_then_get_round_trips_a_value() {
    let state = state();
    set_setting_impl(&state, "steamgriddb_api_key", "abc123").unwrap();
    let value = get_setting_impl(&state, "steamgriddb_api_key").unwrap();
    assert_eq!(value.as_deref(), Some("abc123"));
}

#[test]
fn get_setting_returns_none_when_unset() {
    let state = state();
    assert!(get_setting_impl(&state, "missing_key").unwrap().is_none());
}

#[test]
fn set_setting_upserts_existing_key() {
    let state = state();
    set_setting_impl(&state, "theme", "dark").unwrap();
    set_setting_impl(&state, "theme", "light").unwrap();
    assert_eq!(
        get_setting_impl(&state, "theme").unwrap().as_deref(),
        Some("light")
    );
}

#[test]
fn get_all_settings_returns_all_pairs_ordered_by_key() {
    let state = state();
    set_setting_impl(&state, "theme", "dark").unwrap();
    set_setting_impl(&state, "accent", "violet").unwrap();
    set_setting_impl(&state, "steam_api_key", "key").unwrap();

    let all = get_all_settings_impl(&state).unwrap();
    let keys: Vec<&str> = all.iter().map(|s| s.key.as_str()).collect();
    assert_eq!(keys, vec!["accent", "steam_api_key", "theme"]);

    let theme = all.iter().find(|s| s.key == "theme").unwrap();
    assert_eq!(theme.value.as_deref(), Some("dark"));
}

#[test]
fn get_all_settings_is_empty_on_fresh_db() {
    let state = state();
    assert!(get_all_settings_impl(&state).unwrap().is_empty());
}
