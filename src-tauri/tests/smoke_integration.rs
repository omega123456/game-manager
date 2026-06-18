//! Smoke integration tests for the Phase A1 scaffold.
//!
//! ALL Rust tests live under `src-tauri/tests/` — never inline `#[cfg(test)]` in
//! `src-tauri/src/`. After adding a new test file, register it in both aliases in
//! the repo-root `.cargo/config.toml`.

use game_manager_lib::error::{AppError, AppResult};
use game_manager_lib::logging::init_tracing;
use game_manager_lib::state::AppState;

#[test]
fn app_state_exposes_app_name() {
    let state = AppState::in_memory().expect("in-memory state");
    assert_eq!(state.app_name(), "Game Manager");
}

#[test]
fn app_state_new_uses_temp_app_data_dir() {
    let state = AppState::new(game_manager_lib::db::connection::open_in_memory().unwrap());
    assert_eq!(state.app_name(), "Game Manager");
    assert!(state.app_data_dir().ends_with("game-manager"));
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
fn app_state_with_db_runs_repository_callback() {
    let state = AppState::in_memory().expect("in-memory state");
    let count = state
        .with_db(|conn| {
            let count: i64 =
                conn.query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))?;
            Ok(count)
        })
        .expect("with_db callback");
    assert_eq!(count, 0);
}

#[test]
fn init_tracing_is_idempotent() {
    // Calling twice must not panic (guarded by a `Once`).
    init_tracing();
    init_tracing();
}

#[test]
fn app_state_with_db_reports_poisoned_mutex() {
    let state = AppState::in_memory().expect("in-memory state");
    let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = state.with_db(|_| -> AppResult<()> {
            panic!("poison mutex for test");
        });
    }));
    assert!(poisoned.is_err());

    let err = state
        .with_db(|_| Ok(()))
        .expect_err("poisoned mutex must surface as database error");
    assert!(err.to_string().contains("mutex poisoned"));
}
