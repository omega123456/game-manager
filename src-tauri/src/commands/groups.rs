//! Groups commands (`list_groups`, `get_group`, `create_group`, `update_group`,
//! `delete_group`, `set_group_scripts`).
//!
//! Business logic lives in the `*_impl(&AppState, ...)` functions so it is
//! testable without the Tauri runtime. The repository owns row read/write; this
//! module adds command-layer validation for script assignments.

use std::collections::HashSet;

use serde::Deserialize;

use crate::db::repo::{groups, scripts};
use crate::domain::{Group, ScriptKind};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Frontend payload used by create/update operations.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupUpsertInput {
    /// Display name.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
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

fn normalize_input(input: GroupUpsertInput) -> AppResult<groups::NewGroup> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::other("group name is required"));
    }

    Ok(groups::NewGroup {
        name: name.to_string(),
        description: trim_optional(input.description),
    })
}

fn dedupe_ids(ids: Vec<i64>) -> Vec<i64> {
    let mut seen = HashSet::new();
    ids.into_iter().filter(|id| seen.insert(*id)).collect()
}

fn ensure_normal_scripts_only(state: &AppState, script_ids: &[i64]) -> AppResult<()> {
    state.with_db(|conn| {
        for script_id in script_ids {
            let script = scripts::get(conn, *script_id)?;
            if script.kind != ScriptKind::Normal {
                return Err(AppError::other(format!(
                    "group script assignments only allow normal scripts; script {script_id} is {}",
                    script.kind.as_db_str()
                )));
            }
        }
        Ok(())
    })
}

/// List all groups with assigned scripts and member games.
pub fn list_groups_impl(state: &AppState) -> AppResult<Vec<Group>> {
    state.with_db(groups::list)
}

/// Fetch a single group by id.
pub fn get_group_impl(state: &AppState, id: i64) -> AppResult<Group> {
    state.with_db(|conn| groups::get(conn, id))
}

/// Create a group and return the hydrated row.
pub fn create_group_impl(state: &AppState, input: GroupUpsertInput) -> AppResult<Group> {
    let new_group = normalize_input(input)?;
    state.with_db(|conn| {
        let id = groups::create(conn, &new_group)?;
        groups::get(conn, id)
    })
}

/// Update a group and return the hydrated row.
pub fn update_group_impl(state: &AppState, id: i64, input: GroupUpsertInput) -> AppResult<Group> {
    let updated = normalize_input(input)?;
    state.with_db(|conn| {
        if !groups::update(conn, id, &updated)? {
            return Err(AppError::other(format!("group {id} not found")));
        }
        groups::get(conn, id)
    })
}

/// Delete a group by id.
pub fn delete_group_impl(state: &AppState, id: i64) -> AppResult<()> {
    state.with_db(|conn| {
        if !groups::delete(conn, id)? {
            return Err(AppError::other(format!("group {id} not found")));
        }
        Ok(())
    })
}

/// Replace the set of assigned normal scripts for a group.
pub fn set_group_scripts_impl(
    state: &AppState,
    group_id: i64,
    script_ids: Vec<i64>,
) -> AppResult<Vec<i64>> {
    let script_ids = dedupe_ids(script_ids);
    ensure_normal_scripts_only(state, &script_ids)?;
    state.with_db(|conn| {
        let _ = groups::get(conn, group_id)?;
        groups::set_scripts(conn, group_id, &script_ids)?;
        let group = groups::get(conn, group_id)?;
        Ok(group.script_ids)
    })
}

/// Thin `#[tauri::command]` wrapper delegating to [`list_groups_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn list_groups(state: tauri::State<'_, AppState>) -> AppResult<Vec<Group>> {
    list_groups_impl(&state)
}

/// Thin `#[tauri::command]` wrapper delegating to [`get_group_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn get_group(state: tauri::State<'_, AppState>, id: i64) -> AppResult<Group> {
    get_group_impl(&state, id)
}

/// Thin `#[tauri::command]` wrapper delegating to [`create_group_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn create_group(
    state: tauri::State<'_, AppState>,
    input: GroupUpsertInput,
) -> AppResult<Group> {
    create_group_impl(&state, input)
}

/// Thin `#[tauri::command]` wrapper delegating to [`update_group_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn update_group(
    state: tauri::State<'_, AppState>,
    id: i64,
    input: GroupUpsertInput,
) -> AppResult<Group> {
    update_group_impl(&state, id, input)
}

/// Thin `#[tauri::command]` wrapper delegating to [`delete_group_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn delete_group(state: tauri::State<'_, AppState>, id: i64) -> AppResult<()> {
    delete_group_impl(&state, id)
}

/// Thin `#[tauri::command]` wrapper delegating to [`set_group_scripts_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn set_group_scripts(
    state: tauri::State<'_, AppState>,
    group_id: i64,
    script_ids: Vec<i64>,
) -> AppResult<Vec<i64>> {
    set_group_scripts_impl(&state, group_id, script_ids)
}
