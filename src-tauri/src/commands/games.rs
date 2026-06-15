//! Games commands (`list_games`, `get_game`, `create_game`, `update_game`,
//! `delete_game`, `set_game_groups`, `set_game_scripts`).
//!
//! Business logic lives in the `*_impl(&AppState, ...)` functions so it is
//! testable without the Tauri runtime. The repository owns aggregate
//! computation; this module adds command-layer validation and ergonomic return
//! shapes for the frontend.

use serde::Deserialize;

use crate::db::repo::{games, scripts};
use crate::domain::{Game, MonitorMode, ScriptKind};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Frontend payload used by create/update operations.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameUpsertInput {
    /// Display name.
    pub name: String,
    /// Launch target (exe / shortcut / uri).
    pub launch_target: String,
    /// Process-monitoring mode.
    pub monitor_mode: MonitorMode,
    /// Real process name (required for named-process monitoring).
    pub monitor_process_name: Option<String>,
    /// Optional launch arguments.
    pub arguments: Option<String>,
    /// Optional local cover-art path.
    pub image_path: Option<String>,
}

fn trim_optional(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_input(input: GameUpsertInput) -> AppResult<games::NewGame> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::other("game name is required"));
    }

    let launch_target = input.launch_target.trim();
    if launch_target.is_empty() {
        return Err(AppError::other("launch target is required"));
    }

    let monitor_process_name = trim_optional(input.monitor_process_name);
    if input.monitor_mode == MonitorMode::Named && monitor_process_name.is_none() {
        return Err(AppError::other(
            "monitorProcessName is required when monitorMode is named",
        ));
    }

    Ok(games::NewGame {
        name: name.to_string(),
        launch_target: launch_target.to_string(),
        monitor_mode: input.monitor_mode,
        monitor_process_name,
        arguments: trim_optional(input.arguments),
        image_path: trim_optional(input.image_path),
    })
}

fn ensure_normal_scripts_only(state: &AppState, script_ids: &[i64]) -> AppResult<()> {
    state.with_db(|conn| {
        for script_id in script_ids {
            let script = scripts::get(conn, *script_id)?;
            if script.kind != ScriptKind::Normal {
                return Err(AppError::other(format!(
                    "game script assignments only allow normal scripts; script {script_id} is {}",
                    script.kind.as_db_str()
                )));
            }
        }
        Ok(())
    })
}

/// List all games with computed playtime aggregates.
pub fn list_games_impl(state: &AppState) -> AppResult<Vec<Game>> {
    state.with_db(games::list)
}

/// Fetch a single game by id.
pub fn get_game_impl(state: &AppState, id: i64) -> AppResult<Game> {
    state.with_db(|conn| games::get(conn, id))
}

/// Create a game, returning the hydrated row with aggregates.
pub fn create_game_impl(state: &AppState, input: GameUpsertInput) -> AppResult<Game> {
    let new_game = normalize_input(input)?;
    state.with_db(|conn| {
        let id = games::create(conn, &new_game)?;
        games::get(conn, id)
    })
}

/// Update a game and return the hydrated row.
pub fn update_game_impl(state: &AppState, id: i64, input: GameUpsertInput) -> AppResult<Game> {
    let updated = normalize_input(input)?;
    state.with_db(|conn| {
        if !games::update(conn, id, &updated)? {
            return Err(AppError::other(format!("game {id} not found")));
        }
        games::get(conn, id)
    })
}

/// Delete a game by id.
pub fn delete_game_impl(state: &AppState, id: i64) -> AppResult<()> {
    state.with_db(|conn| {
        if !games::delete(conn, id)? {
            return Err(AppError::other(format!("game {id} not found")));
        }
        Ok(())
    })
}

/// Replace the set of groups a game belongs to.
pub fn set_game_groups_impl(
    state: &AppState,
    game_id: i64,
    group_ids: Vec<i64>,
) -> AppResult<Vec<i64>> {
    state.with_db(|conn| {
        // Ensure the game exists so "not found" is clearer than a junction write error.
        let _ = games::get(conn, game_id)?;
        games::set_groups(conn, game_id, &group_ids)?;
        games::group_ids(conn, game_id)
    })
}

/// Replace the set of directly-assigned normal scripts for a game.
pub fn set_game_scripts_impl(
    state: &AppState,
    game_id: i64,
    script_ids: Vec<i64>,
) -> AppResult<Vec<i64>> {
    ensure_normal_scripts_only(state, &script_ids)?;
    state.with_db(|conn| {
        let _ = games::get(conn, game_id)?;
        games::set_scripts(conn, game_id, &script_ids)?;
        games::script_ids(conn, game_id)
    })
}

/// Thin `#[tauri::command]` wrapper delegating to [`list_games_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn list_games(state: tauri::State<'_, AppState>) -> AppResult<Vec<Game>> {
    list_games_impl(&state)
}

/// Thin `#[tauri::command]` wrapper delegating to [`get_game_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn get_game(state: tauri::State<'_, AppState>, id: i64) -> AppResult<Game> {
    get_game_impl(&state, id)
}

/// Thin `#[tauri::command]` wrapper delegating to [`create_game_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn create_game(state: tauri::State<'_, AppState>, input: GameUpsertInput) -> AppResult<Game> {
    create_game_impl(&state, input)
}

/// Thin `#[tauri::command]` wrapper delegating to [`update_game_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn update_game(
    state: tauri::State<'_, AppState>,
    id: i64,
    input: GameUpsertInput,
) -> AppResult<Game> {
    update_game_impl(&state, id, input)
}

/// Thin `#[tauri::command]` wrapper delegating to [`delete_game_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn delete_game(state: tauri::State<'_, AppState>, id: i64) -> AppResult<()> {
    delete_game_impl(&state, id)
}

/// Thin `#[tauri::command]` wrapper delegating to [`set_game_groups_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn set_game_groups(
    state: tauri::State<'_, AppState>,
    game_id: i64,
    group_ids: Vec<i64>,
) -> AppResult<Vec<i64>> {
    set_game_groups_impl(&state, game_id, group_ids)
}

/// Thin `#[tauri::command]` wrapper delegating to [`set_game_scripts_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn set_game_scripts(
    state: tauri::State<'_, AppState>,
    game_id: i64,
    script_ids: Vec<i64>,
) -> AppResult<Vec<i64>> {
    set_game_scripts_impl(&state, game_id, script_ids)
}
