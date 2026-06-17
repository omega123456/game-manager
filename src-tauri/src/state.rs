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
use crate::keep_awake::{self, KeepAwake, NoopSleepBlocker, SleepBlocker};
use crate::launch::cancel::CancelToken;
use crate::priority::{self, NoopProcessPrioritizer, ProcessPrioritizer};

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
    /// Suppresses system sleep while any launch is registered.
    keep_awake: KeepAwake,
    /// Raises the running game's process priority when the setting is enabled.
    prioritizer: Box<dyn ProcessPrioritizer>,
    /// Session-only DLSS DLL-detection cache, keyed by game id. Detection is
    /// recomputed on every launch and **never** persisted to the DB; this map is
    /// its sole store for the lifetime of the process.
    dlss_detection: Mutex<HashMap<i64, crate::dlss::detect::DetectionResult>>,
}

impl AppState {
    /// Construct an `AppState` backed by the given connection.
    pub fn new(db: Connection) -> Self {
        Self::new_with_app_data_dir(db, std::env::temp_dir().join("game-manager"))
    }

    /// Construct an `AppState` with an explicit writable app-data directory.
    pub fn new_with_app_data_dir(db: Connection, app_data_dir: PathBuf) -> Self {
        Self::with_seams(
            db,
            app_data_dir,
            keep_awake::default_blocker(),
            priority::default_prioritizer(),
        )
    }

    /// Construct an `AppState` over explicit OS seams (sleep blocker + process
    /// prioritizer). Used by the constructors above and by `test-utils` to inject
    /// recording fakes.
    fn with_seams(
        db: Connection,
        app_data_dir: PathBuf,
        blocker: Box<dyn SleepBlocker>,
        prioritizer: Box<dyn ProcessPrioritizer>,
    ) -> Self {
        AppState {
            app_name: "Game Manager".to_string(),
            db: Mutex::new(db),
            app_data_dir,
            launches: Mutex::new(HashMap::new()),
            keep_awake: KeepAwake::new(blocker),
            prioritizer,
            dlss_detection: Mutex::new(HashMap::new()),
        }
    }

    /// Construct an `AppState` backed by a fresh in-memory database.
    ///
    /// Used by tests and as a safe fallback. The connection is configured and
    /// migrated by [`connection::open_in_memory`]. Uses a no-op sleep blocker so
    /// tests never spawn the keep-awake worker or touch real OS sleep state.
    pub fn in_memory() -> AppResult<Self> {
        Ok(AppState::with_seams(
            connection::open_in_memory()?,
            std::env::temp_dir().join("game-manager"),
            Box::new(NoopSleepBlocker),
            Box::new(NoopProcessPrioritizer),
        ))
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
        drop(launches);
        // Keep the machine awake for the duration of the launch.
        self.keep_awake.acquire();
        Ok(token)
    }

    /// Remove the launch registration for `game_id` (called when it finishes).
    pub fn unregister_launch(&self, game_id: i64) {
        let removed = match self.launches.lock() {
            Ok(mut launches) => launches.remove(&game_id).is_some(),
            Err(_) => false,
        };
        // Balance the `acquire` from `register_launch` only when we actually
        // removed a registration, so sleep is restored once no launch remains.
        if removed {
            self.keep_awake.release();
        }
    }

    /// Raise the game process `pid` to High priority when the
    /// `raise_game_priority` setting is enabled (the default when unset).
    ///
    /// Best-effort: a disabled setting, a read error, or an OS failure is logged
    /// and swallowed so the launch is never blocked.
    pub fn raise_priority_if_enabled(&self, pid: u32) {
        let enabled = self
            .with_db(|conn| crate::db::repo::settings::get(conn, "raise_game_priority"))
            .ok()
            .flatten()
            // Default ON: only an explicit "false" disables the boost.
            .map(|value| value != "false")
            .unwrap_or(true);
        if !enabled {
            return;
        }
        if let Err(err) = self.prioritizer.set_high(pid) {
            tracing::warn!(
                category = "launch",
                "failed to raise priority for pid {pid}: {err}"
            );
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

    /// Store a game's session-only DLSS detection result, replacing any prior one.
    pub fn dlss_detection_set(
        &self,
        game_id: i64,
        result: crate::dlss::detect::DetectionResult,
    ) {
        match self.dlss_detection.lock() {
            Ok(mut map) => {
                map.insert(game_id, result);
            }
            Err(_) => {
                tracing::warn!(
                    category = "dlss",
                    game_id,
                    "dlss detection cache mutex poisoned; detection not cached"
                );
            }
        }
    }

    /// Read a game's cached DLSS detection, or `None` if it has not been scanned
    /// this session.
    pub fn dlss_detection_get(
        &self,
        game_id: i64,
    ) -> Option<crate::dlss::detect::DetectionResult> {
        self.dlss_detection
            .lock()
            .ok()
            .and_then(|map| map.get(&game_id).cloned())
    }

    /// Drop cached DLSS detections for any game id not in `live_ids` (called
    /// after a full library scan so deleted games leave the cache).
    pub fn dlss_detection_retain(&self, live_ids: &std::collections::HashSet<i64>) {
        if let Ok(mut map) = self.dlss_detection.lock() {
            map.retain(|game_id, _| live_ids.contains(game_id));
        }
    }

    /// Drop the cached DLSS detection for a single game (called when it is
    /// deleted) so it stops counting toward the applicable totals immediately.
    pub fn dlss_detection_remove(&self, game_id: i64) {
        if let Ok(mut map) = self.dlss_detection.lock() {
            map.remove(&game_id);
        }
    }

    /// Snapshot every cached DLSS detection as `(game_id, result)` pairs.
    pub fn dlss_detection_snapshot(&self) -> Vec<(i64, crate::dlss::detect::DetectionResult)> {
        self.dlss_detection
            .lock()
            .map(|map| map.iter().map(|(id, result)| (*id, result.clone())).collect())
            .unwrap_or_default()
    }
}

#[cfg(feature = "test-utils")]
impl AppState {
    /// Construct an in-memory `AppState` over a caller-supplied sleep blocker so
    /// tests can assert that launches engage/release the keep-awake controller.
    pub fn in_memory_with_blocker(blocker: Box<dyn SleepBlocker>) -> AppResult<Self> {
        Ok(AppState::with_seams(
            connection::open_in_memory()?,
            std::env::temp_dir().join("game-manager"),
            blocker,
            Box::new(NoopProcessPrioritizer),
        ))
    }

    /// Construct an in-memory `AppState` over a caller-supplied process
    /// prioritizer so tests can assert that launches raise the game's priority.
    pub fn in_memory_with_prioritizer(
        prioritizer: Box<dyn ProcessPrioritizer>,
    ) -> AppResult<Self> {
        Ok(AppState::with_seams(
            connection::open_in_memory()?,
            std::env::temp_dir().join("game-manager"),
            Box::new(NoopSleepBlocker),
            prioritizer,
        ))
    }

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

    /// Poison the DLSS detection-cache mutex so error paths can be exercised in tests.
    pub fn poison_dlss_detection_mutex_for_test(&self) {
        let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = self
                .dlss_detection
                .lock()
                .expect("dlss detection mutex should be available");
            panic!("poison dlss detection mutex for test");
        }));
        assert!(poisoned.is_err(), "mutex poison helper must panic");
    }
}
