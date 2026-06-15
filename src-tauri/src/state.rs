//! Shared application state.
//!
//! `AppState` is injected into every command `*_impl(state: &AppState, ...)` so
//! business logic is testable without the Tauri runtime. As of Phase A2 it owns
//! the mutex-guarded SQLite connection (the single source of truth). The active
//! launch registry is added in Phase E1.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;

use crate::db::connection;
use crate::error::{AppError, AppResult};
use crate::launch::cancel::CancelToken;

/// Application state container injected into command implementations.
pub struct AppState {
    /// Human-readable app name marker.
    app_name: String,
    /// The single SQLite connection, mutex-guarded for cross-thread command access.
    db: Mutex<Connection>,
    /// Writable application-data root for caches and other local assets.
    app_data_dir: PathBuf,
    /// Registry of in-flight launches keyed by game id, holding each launch's
    /// cancellation token so `cancel_launch` can target a running launch.
    launches: Mutex<HashMap<i64, CancelToken>>,
}

impl AppState {
    /// Construct an `AppState` backed by the given connection.
    pub fn new(db: Connection) -> Self {
        Self::new_with_app_data_dir(db, std::env::temp_dir().join("game-manager"))
    }

    /// Construct an `AppState` with an explicit writable app-data directory.
    pub fn new_with_app_data_dir(db: Connection, app_data_dir: PathBuf) -> Self {
        AppState {
            app_name: "Game Manager".to_string(),
            db: Mutex::new(db),
            app_data_dir,
            launches: Mutex::new(HashMap::new()),
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

    /// The writable application-data directory used for cached assets.
    pub fn app_data_dir(&self) -> &Path {
        &self.app_data_dir
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

    /// Register a fresh cancellation token for `game_id`, replacing any prior
    /// one, and return it. Returns an error when any launch is already active so
    /// overlapping launches cannot race the lifecycle UI and cancel tracking.
    pub fn register_launch(&self, game_id: i64) -> AppResult<CancelToken> {
        let token = CancelToken::new();
        let mut launches = self
            .launches
            .lock()
            .map_err(|_| AppError::other("launch registry mutex poisoned"))?;
        if launches.contains_key(&game_id) {
            return Err(AppError::other(format!("game {game_id} is already launching")));
        }
        if let Some(active_game_id) = launches.keys().next().copied() {
            return Err(AppError::other(format!(
                "game {active_game_id} is already launching"
            )));
        }
        launches.insert(game_id, token.clone());
        Ok(token)
    }

    /// Remove the launch registration for `game_id` (called when it finishes).
    pub fn unregister_launch(&self, game_id: i64) {
        if let Ok(mut launches) = self.launches.lock() {
            launches.remove(&game_id);
        }
    }

    /// Cancel an in-flight launch for `game_id`. Returns whether one was active.
    pub fn cancel_launch(&self, game_id: i64) -> bool {
        match self.launches.lock() {
            Ok(launches) => match launches.get(&game_id) {
                Some(token) => {
                    token.cancel();
                    true
                }
                None => false,
            },
            Err(_) => false,
        }
    }
}

#[cfg(feature = "test-utils")]
impl AppState {
    /// Poison the launch-registry mutex so error paths can be exercised in tests.
    pub fn poison_launches_mutex_for_test(&self) {
        let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = self
                .launches
                .lock()
                .expect("launch registry mutex should be available");
            panic!("poison launch registry mutex for test");
        }));
        assert!(poisoned.is_err(), "mutex poison helper must panic");
    }
}
