//! Game Manager — Tauri backend library crate.
//!
//! The Rust backend owns all stateful logic. Commands follow the
//! `*_impl(state: &AppState, ...)` + thin `#[tauri::command]` wrapper pattern so
//! business logic is testable without the Tauri runtime.

pub mod art;
pub mod commands;
pub mod db;
pub mod domain;
pub mod error;
pub mod keep_awake;
pub mod logging;
pub mod launch;
pub mod monitor;
pub mod priority;
pub mod state;

use std::path::{Path, PathBuf};

#[cfg(not(coverage))]
use state::AppState;

/// Directory for SQLite, cached art, and other app data.
///
/// In debug builds (`pnpm tauri dev`, `cargo build`), uses a sibling folder with
/// `-dev` before the final extension (e.g. `app.gamemanager-dev.desktop`) so
/// development does not read or write the same files as release installs.
pub fn resolved_app_data_dir(base: &Path) -> PathBuf {
    #[cfg(debug_assertions)]
    {
        match base.file_name().and_then(|n| n.to_str()) {
            Some(name) => {
                let dev_name = if let Some((stem, suffix)) = name.rsplit_once('.') {
                    format!("{stem}-dev.{suffix}")
                } else {
                    format!("{name}-dev")
                };
                base.with_file_name(dev_name)
            }
            None => base.to_path_buf(),
        }
    }
    #[cfg(not(debug_assertions))]
    {
        base.to_path_buf()
    }
}

/// Open the application database in the given app-data directory.
///
/// Falls back to an in-memory database (logged) if the directory cannot be
/// resolved or created, so the app still starts.
#[cfg(not(coverage))]
fn open_app_database(dir: &Path) -> error::AppResult<rusqlite::Connection> {
    std::fs::create_dir_all(dir)
        .map_err(|err| error::AppError::Io(format!("create app data dir: {err}")))?;
    db::connection::open(&dir.join("game-manager.db"))
}

/// Build and run the Tauri application.
///
/// Excluded from coverage instrumentation (`--cfg coverage`) because driving the
/// real Tauri runtime + WebView is not exercisable in a headless coverage run.
#[cfg(not(coverage))]
pub fn run() {
    logging::init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;

            let base = app.path().app_data_dir().map_err(|err| {
                error::AppError::database(format!("app data dir unavailable: {err}"))
            })?;
            let app_data_dir = resolved_app_data_dir(&base);
            let conn = match open_app_database(&app_data_dir) {
                Ok(conn) => conn,
                Err(err) => {
                    tracing::error!(category = "db", "{err}; falling back to in-memory database");
                    db::connection::open_in_memory().expect("in-memory database must open")
                }
            };

            // Prune expired logs on startup.
            if let Err(err) = logging::run_retention(&conn) {
                tracing::warn!(category = "logging", "startup retention failed: {err}");
            }

            app.manage(AppState::new_with_app_data_dir(conn, app_data_dir.clone()));

            // Daily retention loop on its own connection (the AppState connection
            // is mutex-guarded and owned by command handlers).
            let db_path = app_data_dir.join("game-manager.db");
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(24 * 60 * 60));
                match db::connection::open(&db_path) {
                    Ok(conn) => {
                        if let Err(err) = logging::run_retention(&conn) {
                            tracing::warn!(
                                category = "logging",
                                "daily retention failed: {err}"
                            );
                        }
                    }
                    Err(err) => {
                        tracing::warn!(
                            category = "logging",
                            "daily retention open failed: {err}"
                        );
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::logging::log_frontend,
            commands::games::list_games,
            commands::games::get_game,
            commands::games::get_play_now_game,
            commands::games::create_game,
            commands::games::update_game,
            commands::games::delete_game,
            commands::games::set_game_groups,
            commands::games::set_game_scripts,
            commands::games::get_resolved_scripts,
            commands::groups::list_groups,
            commands::groups::get_group,
            commands::groups::create_group,
            commands::groups::update_group,
            commands::groups::delete_group,
            commands::groups::set_group_scripts,
            commands::scripts::list_scripts,
            commands::scripts::get_script,
            commands::scripts::create_script,
            commands::scripts::update_script,
            commands::scripts::delete_script,
            commands::scripts::set_script_dependencies,
            commands::scripts::set_script_kind,
            commands::art::search_art,
            commands::art::fetch_metadata,
            commands::art::cache_art_candidate,
            commands::settings::get_all_settings,
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::launch::launch_game,
            commands::launch::cancel_launch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Game Manager application");
}
