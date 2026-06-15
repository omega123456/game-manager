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
pub mod logging;
pub mod state;

use state::AppState;

/// Open the application database in the platform app-data directory.
///
/// Falls back to an in-memory database (logged) if the directory cannot be
/// resolved or created, so the app still starts.
#[cfg(not(coverage))]
fn open_app_database(handle: &tauri::AppHandle) -> error::AppResult<rusqlite::Connection> {
    use tauri::Manager;

    let dir = handle
        .path()
        .app_data_dir()
        .map_err(|err| error::AppError::database(format!("app data dir unavailable: {err}")))?;
    std::fs::create_dir_all(&dir)
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

            let app_data_dir = app.path().app_data_dir().map_err(|err| {
                error::AppError::database(format!("app data dir unavailable: {err}"))
            })?;
            let conn = match open_app_database(app.handle()) {
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
            if let Ok(dir) = app.path().app_data_dir() {
                let db_path = dir.join("game-manager.db");
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
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::logging::log_frontend,
            commands::games::list_games,
            commands::games::get_game,
            commands::games::create_game,
            commands::games::update_game,
            commands::games::delete_game,
            commands::games::set_game_groups,
            commands::games::set_game_scripts,
            commands::art::search_art,
            commands::art::fetch_metadata,
            commands::art::cache_art_candidate,
            commands::settings::get_all_settings,
            commands::settings::get_setting,
            commands::settings::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Game Manager application");
}
