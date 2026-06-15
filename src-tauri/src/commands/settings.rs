//! Settings commands (`get_all_settings`, `get_setting`, `set_setting`).
//!
//! A thin command surface over the key/value `settings` repository
//! (`db::repo::settings`). Each command is a testable `*_impl(&AppState, ...)`
//! plus a `#[tauri::command]` wrapper registered in `lib.rs` and granted via
//! `permissions/settings.toml` + `capabilities/default.json`.
//!
//! Values (including API keys) are stored verbatim/plaintext — this is a
//! single-user local app and keys are not encrypted at rest.

use crate::db::repo::settings;
use crate::domain::Setting;
use crate::error::AppResult;
use crate::state::AppState;

/// Read every setting as a list of key/value pairs, ordered by key.
pub fn get_all_settings_impl(state: &AppState) -> AppResult<Vec<Setting>> {
    state.with_db(|conn| {
        let pairs = settings::get_all(conn)?;
        Ok(pairs
            .into_iter()
            .map(|(key, value)| Setting { key, value })
            .collect())
    })
}

/// Read a single setting value, or `None` when unset.
pub fn get_setting_impl(state: &AppState, key: &str) -> AppResult<Option<String>> {
    state.with_db(|conn| settings::get(conn, key))
}

/// Upsert a single setting value.
pub fn set_setting_impl(state: &AppState, key: &str, value: &str) -> AppResult<()> {
    state.with_db(|conn| settings::set(conn, key, value))
}

/// Thin `#[tauri::command]` wrapper delegating to [`get_all_settings_impl`].
///
/// Pure Tauri-runtime glue (logic lives in the unit-tested `*_impl`), so it is
/// excluded from coverage instrumentation under `--cfg coverage`, matching the
/// sanctioned runtime-boundary exclusion established in Phase A1.
#[cfg(not(coverage))]
#[tauri::command]
pub fn get_all_settings(state: tauri::State<'_, AppState>) -> AppResult<Vec<Setting>> {
    get_all_settings_impl(&state)
}

/// Thin `#[tauri::command]` wrapper delegating to [`get_setting_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn get_setting(state: tauri::State<'_, AppState>, key: String) -> AppResult<Option<String>> {
    get_setting_impl(&state, &key)
}

/// Thin `#[tauri::command]` wrapper delegating to [`set_setting_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn set_setting(state: tauri::State<'_, AppState>, key: String, value: String) -> AppResult<()> {
    set_setting_impl(&state, &key, &value)
}
