//! Shared application state.
//!
//! `AppState` is injected into every command `*_impl(state: &AppState, ...)` so
//! business logic is testable without the Tauri runtime. As of Phase A2 it owns
//! the mutex-guarded SQLite connection (the single source of truth). The active
//! launch registry is added in Phase E1.

use std::sync::Mutex;

use rusqlite::Connection;

use crate::db::connection;
use crate::error::{AppError, AppResult};

/// Application state container injected into command implementations.
pub struct AppState {
    /// Human-readable app name marker.
    app_name: String,
    /// The single SQLite connection, mutex-guarded for cross-thread command access.
    db: Mutex<Connection>,
}

impl AppState {
    /// Construct an `AppState` backed by the given connection.
    pub fn new(db: Connection) -> Self {
        AppState {
            app_name: "Game Manager".to_string(),
            db: Mutex::new(db),
        }
    }

    /// Construct an `AppState` backed by a fresh in-memory database.
    ///
    /// Used by tests and as a safe fallback. The connection is configured and
    /// migrated by [`connection::open_in_memory`].
    pub fn in_memory() -> AppResult<Self> {
        Ok(AppState::new(connection::open_in_memory()?))
    }

    /// The application name.
    pub fn app_name(&self) -> &str {
        &self.app_name
    }

    /// Run `f` with a locked reference to the database connection.
    ///
    /// Centralizes mutex-poisoning handling so command `*_impl`s never touch the
    /// lock directly.
    pub fn with_db<T>(&self, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let guard = self
            .db
            .lock()
            .map_err(|_| AppError::database("database connection mutex poisoned"))?;
        f(&guard)
    }
}
