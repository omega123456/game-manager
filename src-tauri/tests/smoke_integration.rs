//! Smoke integration tests for the Phase A1 scaffold.
//!
//! ALL Rust tests live under `src-tauri/tests/` — never inline `#[cfg(test)]` in
//! `src-tauri/src/`. After adding a new test file, register it in both aliases in
//! `src-tauri/.cargo/config.toml`.

use game_manager_lib::error::{AppError, AppResult};
use game_manager_lib::logging::init_tracing;
use game_manager_lib::state::AppState;

#[test]
fn app_state_exposes_app_name() {
    let state = AppState::in_memory().expect("in-memory state");
    assert_eq!(state.app_name(), "Game Manager");
}

#[test]
fn app_error_serializes_to_display_string() {
    let err = AppError::other("boom");
    assert_eq!(err.to_string(), "boom");
    assert_eq!(serde_json::to_string(&err).unwrap(), "\"boom\"");

    let io = AppError::Io("disk".to_string());
    assert_eq!(io.to_string(), "io error: disk");

    let db = AppError::Database("locked".to_string());
    assert_eq!(db.to_string(), "database error: locked");
}

#[test]
fn app_result_alias_carries_app_error() {
    let ok: AppResult<u8> = Ok(7);
    assert_eq!(ok.unwrap(), 7);

    let failed: AppResult<u8> = Err(AppError::other("nope"));
    assert!(failed.is_err());
}

#[test]
fn init_tracing_is_idempotent() {
    // Calling twice must not panic (guarded by a `Once`).
    init_tracing();
    init_tracing();
}
