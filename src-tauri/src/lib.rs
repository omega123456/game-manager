//! Game Manager — Tauri backend library crate.
//!
//! The Rust backend owns all stateful logic. Commands follow the
//! `*_impl(state: &AppState, ...)` + thin `#[tauri::command]` wrapper pattern so
//! business logic is testable without the Tauri runtime.

pub mod art;
pub mod commands;
pub mod db;
pub mod dlss;
pub mod domain;
pub mod error;
pub mod keep_awake;
pub mod launch;
pub mod logging;
pub mod monitor;
pub mod priority;
pub mod state;

use std::path::{Path, PathBuf};

#[cfg(not(coverage))]
use state::AppState;

#[cfg(not(coverage))]
fn run_maintenance(conn: &rusqlite::Connection, phase: &str) {
    if let Err(err) = logging::run_retention(conn) {
        tracing::warn!(category = "logging", "{phase} retention failed: {err}");
    }
    match db::repo::launch_runs::cleanup_old_runs(conn) {
        Ok(removed) if removed > 0 => {
            tracing::info!(
                category = "launch",
                "{phase} cleanup pruned {removed} stale launch run(s)"
            );
        }
        Ok(_) => {}
        Err(err) => {
            tracing::warn!(
                category = "launch",
                "{phase} launch-run cleanup failed: {err}"
            );
        }
    }
}

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

/// Block browser-shell behaviors (page refresh, right-click menu, find-on-page,
/// view-source, and — in release — DevTools) so the WebView behaves like a native
/// app window rather than a browser.
///
/// DevTools shortcuts (F12 / Ctrl+Shift+I) stay live in debug builds so
/// `pnpm tauri dev` keeps DevTools, and are blocked in release.
#[cfg(not(coverage))]
fn prevent_default_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_prevent_default::Flags;

    let flags = if cfg!(debug_assertions) {
        Flags::all().difference(Flags::DEV_TOOLS)
    } else {
        Flags::all()
    };

    #[cfg(target_os = "windows")]
    {
        use tauri_plugin_prevent_default::PlatformOptions;

        tauri_plugin_prevent_default::Builder::new()
            .with_flags(flags)
            .platform(
                PlatformOptions::new()
                    .general_autofill(false)
                    .password_autosave(false)
                    // WebView2 disables F12/Ctrl+Shift+I when false; keep true in debug so DevTools work with `tauri dev`.
                    .browser_accelerator_keys(cfg!(debug_assertions))
                    // Always enable at the WebView2 level to prevent a black screen
                    // in production builds. WRY sets `AreDevToolsEnabled(false)` when
                    // the Tauri `devtools` feature is off, and some WebView2 runtime
                    // versions fail to render the page in that state. Re-enabling it
                    // here is safe because all shortcuts that open DevTools are already
                    // blocked: `Flags::DEV_TOOLS` prevents Ctrl+Shift+I via the
                    // injected JS, `browser_accelerator_keys(false)` disables F12 and
                    // other browser shortcuts, and `Flags::CONTEXT_MENU` removes the
                    // right-click menu.
                    .dev_tools(true),
            )
            .build()
    }

    #[cfg(not(target_os = "windows"))]
    {
        tauri_plugin_prevent_default::Builder::new()
            .with_flags(flags)
            .build()
    }
}

/// Build and run the Tauri application.
///
/// Excluded from coverage instrumentation (`--cfg coverage`) because driving the
/// real Tauri runtime + WebView is not exercisable in a headless coverage run.
#[cfg(not(coverage))]
pub fn run() {
    logging::init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(prevent_default_plugin())
        .plugin(tauri_plugin_window_state::Builder::default().build())
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

            run_maintenance(&conn, "startup");

            app.manage(AppState::new_with_app_data_dir(conn, app_data_dir.clone()));

            // DLSS detection is session-only: scan every game's install folder on
            // launch to populate the in-memory cache (never persisted). Runs on a
            // blocking worker so slow recursive DLL reads never delay startup.
            commands::dlss::spawn_library_scan(app.handle().clone());

            // Daily retention loop on its own connection (the AppState connection
            // is mutex-guarded and owned by command handlers).
            let db_path = app_data_dir.join("game-manager.db");
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(24 * 60 * 60));
                match db::connection::open(&db_path) {
                    Ok(conn) => {
                        run_maintenance(&conn, "daily");
                    }
                    Err(err) => {
                        tracing::warn!(category = "logging", "daily retention open failed: {err}");
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::logging::log_frontend,
            commands::logging::list_logs,
            commands::games::list_games,
            commands::games::get_game,
            commands::games::get_play_now_game,
            commands::games::create_game,
            commands::games::update_game,
            commands::games::delete_game,
            commands::games::set_game_groups,
            commands::games::set_game_scripts,
            commands::games::get_resolved_scripts,
            commands::games::get_latest_launch_run,
            commands::groups::list_groups,
            commands::groups::get_group,
            commands::groups::create_group,
            commands::groups::update_group,
            commands::groups::delete_group,
            commands::groups::set_group_scripts,
            commands::groups::set_group_games,
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
            commands::dlss::dlss_get_support,
            commands::dlss::dlss_get_catalog,
            commands::dlss::dlss_get_game_state,
            commands::dlss::dlss_list_game_states,
            commands::dlss::dlss_scan_game,
            commands::dlss::dlss_scan_library,
            commands::dlss::dlss_set_folder_override,
            commands::dlss::dlss_download_version,
            commands::dlss::dlss_cancel_download,
            commands::dlss::dlss_apply_to_game,
            commands::dlss::dlss_apply_to_all,
            commands::dlss::dlss_count_applicable,
            commands::dlss::dlss_get_preset_options,
            commands::dlss::dlss_get_global_indicator,
            commands::dlss::dlss_set_global_indicator,
            commands::dlss::dlss_get_global_preset,
            commands::dlss::dlss_set_global_preset,
            commands::dlss::dlss_get_game_preset,
            commands::dlss::dlss_set_game_preset,
            commands::dlss::dlss_save_game,
            commands::dlss::dlss_relaunch_elevated,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Game Manager application");
}
