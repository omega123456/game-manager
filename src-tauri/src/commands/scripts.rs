//! Scripts commands (`list_scripts`, `get_script`, `create_script`,
//! `update_script`, `delete_script`, `set_script_dependencies`,
//! `set_script_kind`).
//!
//! Business logic lives in the `*_impl(&AppState, ...)` functions so it is
//! testable without the Tauri runtime. The repository owns row read/write; this
//! module adds command-layer validation:
//!
//! - kind-dependent shape normalization (normal/global keep the three lifecycle
//!   phases + priority and clear the snippet; utility keeps the single snippet
//!   and clears the phases) so the schema `CHECK`s are always satisfied;
//! - `set_script_dependencies` validates that **every** require target is a
//!   `utility` script and runs DFS cycle detection (direct + transitive) before
//!   persisting — SQLite cannot `CHECK` a referenced row's column, so this rule
//!   is authoritative here;
//! - `set_script_kind` / `update_script` reject reclassifying a `utility` away
//!   from `utility` while other scripts still require it (which would strand the
//!   inbound require edges), rather than cascade-deleting those edges.

use std::collections::{HashMap, HashSet};

use rusqlite::Connection;
use serde::Deserialize;

use crate::db::repo::scripts;
use crate::domain::{Interpreter, PhaseConfig, PhaseMode, Script, ScriptKind};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Frontend payload for one phase / snippet column-group.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseInput {
    /// How the phase/snippet is sourced.
    pub mode: PhaseMode,
    /// External path (when `mode == Path`).
    pub path: Option<String>,
    /// Inline code (when `mode == Inline`).
    pub inline: Option<String>,
    /// Interpreter for inline code.
    pub interpreter: Option<Interpreter>,
}

/// Frontend payload used by create/update operations.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptUpsertInput {
    /// Display name.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Mutually-exclusive kind.
    pub kind: ScriptKind,
    /// Priority 1–10 (used by normal/global; ignored for utility).
    pub priority: i64,
    /// Before-launch phase (normal/global only).
    #[serde(default)]
    pub before_launch: PhaseInput,
    /// After-process-detected phase (normal/global only).
    #[serde(default)]
    pub after_launch: PhaseInput,
    /// On-exit phase (normal/global only).
    #[serde(default)]
    pub on_exit: PhaseInput,
    /// The single snippet (utility only).
    #[serde(default)]
    pub snippet: PhaseInput,
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

/// Normalize a single phase/snippet column-group, enforcing internal coherence.
///
/// Every phase is optional: a mode whose payload is empty/whitespace-only is
/// treated as `none` (the empty field is ignored) rather than rejected.
///
/// - `none`  → all payload fields cleared;
/// - `path`  → empty path collapses to `none`; otherwise inline/interpreter cleared;
/// - `inline`→ empty code collapses to `none`; otherwise an interpreter is required.
fn normalize_phase(label: &str, input: PhaseInput) -> AppResult<PhaseConfig> {
    match input.mode {
        PhaseMode::None => Ok(PhaseConfig::default()),
        PhaseMode::Path => match trim_optional(input.path) {
            None => Ok(PhaseConfig::default()),
            Some(path) => Ok(PhaseConfig {
                mode: PhaseMode::Path,
                path: Some(path),
                inline: None,
                interpreter: None,
            }),
        },
        PhaseMode::Inline => match trim_optional(input.inline) {
            None => Ok(PhaseConfig::default()),
            Some(inline) => {
                let interpreter = input.interpreter.ok_or_else(|| {
                    AppError::other(format!("{label} interpreter is required for inline mode"))
                })?;
                Ok(PhaseConfig {
                    mode: PhaseMode::Inline,
                    path: None,
                    inline: Some(inline),
                    interpreter: Some(interpreter),
                })
            }
        },
    }
}

/// Normalize the upsert payload into a repo [`scripts::NewScript`], enforcing the
/// kind-dependent shape (phases empty for utility; snippet empty for
/// normal/global) so the schema `CHECK`s never reject the write.
fn normalize_input(input: ScriptUpsertInput) -> AppResult<scripts::NewScript> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::other("script name is required"));
    }

    if !(1..=10).contains(&input.priority) {
        return Err(AppError::other("priority must be between 1 and 10"));
    }

    let (before_launch, after_launch, on_exit, snippet) = match input.kind {
        ScriptKind::Utility => (
            PhaseConfig::default(),
            PhaseConfig::default(),
            PhaseConfig::default(),
            normalize_phase("snippet", input.snippet)?,
        ),
        ScriptKind::Normal | ScriptKind::Global => (
            normalize_phase("beforeLaunch", input.before_launch)?,
            normalize_phase("afterLaunch", input.after_launch)?,
            normalize_phase("onExit", input.on_exit)?,
            PhaseConfig::default(),
        ),
    };

    Ok(scripts::NewScript {
        name: name.to_string(),
        description: trim_optional(input.description),
        kind: input.kind,
        priority: input.priority,
        before_launch,
        after_launch,
        on_exit,
        snippet,
    })
}

/// Reject reclassifying a `utility` script away from `utility` while other
/// scripts still require it.
///
/// Require edges may only target utility scripts (enforced on insert by
/// [`ensure_targets_are_utilities`]). If a depended-upon utility were silently
/// flipped to `normal`/`global`, the existing `script_dependencies` rows
/// pointing at it would become invalid — stranding edges the insert path
/// forbids and breaking the resolver's "every required id is a utility"
/// assumption. Rather than cascade-delete those edges, we reject the operation
/// and ask the caller to remove the requirements first.
///
/// Only the `utility -> non-utility` transition can strand edges, so other
/// transitions are no-ops here.
fn ensure_kind_change_does_not_strand_edges(
    conn: &Connection,
    id: i64,
    old_kind: ScriptKind,
    new_kind: ScriptKind,
) -> AppResult<()> {
    if old_kind != ScriptKind::Utility || new_kind == ScriptKind::Utility {
        return Ok(());
    }

    let dependents = scripts::dependent_ids(conn, id)?;
    if dependents.is_empty() {
        return Ok(());
    }

    tracing::warn!(
        script_id = id,
        new_kind = new_kind.as_db_str(),
        dependent_count = dependents.len(),
        dependents = ?dependents,
        "rejected utility reclassification: dependent scripts still require it"
    );

    Err(AppError::other(format!(
        "cannot change this utility to {}: {} script(s) still require it; \
         remove those requirements first",
        new_kind.as_db_str(),
        dependents.len()
    )))
}

/// Validate that every `depends_on` target exists and is a utility script.
fn ensure_targets_are_utilities(conn: &Connection, depends_on: &[i64]) -> AppResult<()> {
    for target in depends_on {
        let target_script = scripts::get(conn, *target)?;
        if target_script.kind != ScriptKind::Utility {
            return Err(AppError::other(format!(
                "require edges may only target utility scripts; script {target} is {}",
                target_script.kind.as_db_str()
            )));
        }
    }
    Ok(())
}

/// DFS cycle detection over the require graph with `script_id`'s edges replaced
/// by the proposed `depends_on` set.
///
/// Returns an error if any target equals `script_id` (a direct self-cycle) or if
/// following the proposed edges — then the existing edges of every other node —
/// can reach `script_id` again (a transitive cycle).
fn ensure_no_cycle(conn: &Connection, script_id: i64, depends_on: &[i64]) -> AppResult<()> {
    // Build adjacency for the proposed graph: existing edges everywhere, except
    // `script_id`'s edges are overridden with the candidate `depends_on` set.
    let mut adjacency: HashMap<i64, Vec<i64>> = HashMap::new();
    adjacency.insert(script_id, depends_on.to_vec());

    let mut visited: HashSet<i64> = HashSet::new();
    let mut stack: Vec<i64> = depends_on.to_vec();

    while let Some(node) = stack.pop() {
        if node == script_id {
            return Err(AppError::other(
                "saving this requirement would create a circular reference",
            ));
        }
        if !visited.insert(node) {
            continue;
        }
        // `i64: Copy`, so extend straight from the stored slice without cloning
        // the adjacency `Vec`. On a cache miss, store the fetched edges first,
        // then read them back from the map for the extend.
        if !adjacency.contains_key(&node) {
            let edges = scripts::require_ids(conn, node)?;
            adjacency.insert(node, edges);
        }
        stack.extend(adjacency[&node].iter().copied());
    }

    Ok(())
}

/// List all scripts (with `requires` populated) ordered by name.
pub fn list_scripts_impl(state: &AppState) -> AppResult<Vec<Script>> {
    state.with_db(scripts::list)
}

/// Fetch a single script by id.
pub fn get_script_impl(state: &AppState, id: i64) -> AppResult<Script> {
    state.with_db(|conn| scripts::get(conn, id))
}

/// Create a script, returning the hydrated row.
pub fn create_script_impl(state: &AppState, input: ScriptUpsertInput) -> AppResult<Script> {
    let new_script = normalize_input(input)?;
    state.with_db(|conn| {
        let id = scripts::create(conn, &new_script)?;
        scripts::get(conn, id)
    })
}

/// Update a script (excluding `requires`) and return the hydrated row.
pub fn update_script_impl(
    state: &AppState,
    id: i64,
    input: ScriptUpsertInput,
) -> AppResult<Script> {
    let updated = normalize_input(input)?;
    state.with_db(|conn| {
        // Read the current kind first: if this update reclassifies a utility
        // away from `utility` while other scripts still require it, reject. A
        // missing row is reported by `scripts::update` below to preserve the
        // existing not-found message.
        if let Some(old_kind) = scripts::kind_of(conn, id)? {
            ensure_kind_change_does_not_strand_edges(conn, id, old_kind, updated.kind)?;
        }
        if !scripts::update(conn, id, &updated)? {
            return Err(AppError::other(format!("script {id} not found")));
        }
        scripts::get(conn, id)
    })
}

/// Delete a script by id.
pub fn delete_script_impl(state: &AppState, id: i64) -> AppResult<()> {
    state.with_db(|conn| {
        if !scripts::delete(conn, id)? {
            return Err(AppError::other(format!("script {id} not found")));
        }
        Ok(())
    })
}

/// Replace a script's `requires` edges after validating utility-only targets and
/// running DFS cycle detection. Returns the persisted require ids.
pub fn set_script_dependencies_impl(
    state: &AppState,
    script_id: i64,
    depends_on: Vec<i64>,
) -> AppResult<Vec<i64>> {
    // Deduplicate while preserving determinism; self-edges are caught by the
    // cycle check below.
    let mut seen = HashSet::new();
    let unique: Vec<i64> = depends_on
        .into_iter()
        .filter(|id| seen.insert(*id))
        .collect();

    state.with_db(|conn| {
        // Ensure the owning script exists for a clear error.
        let _ = scripts::get(conn, script_id)?;
        ensure_targets_are_utilities(conn, &unique)?;
        ensure_no_cycle(conn, script_id, &unique)?;
        scripts::set_dependencies(conn, script_id, &unique)?;
        scripts::require_ids(conn, script_id)
    })
}

/// Update only a script's kind, normalizing the shape so the new kind's
/// inactive column-group is cleared (satisfying the schema `CHECK`s).
pub fn set_script_kind_impl(state: &AppState, id: i64, kind: ScriptKind) -> AppResult<Script> {
    state.with_db(|conn| {
        let existing = scripts::get(conn, id)?;
        ensure_kind_change_does_not_strand_edges(conn, id, existing.kind, kind)?;
        let normalized = scripts::NewScript {
            name: existing.name,
            description: existing.description,
            kind,
            priority: existing.priority,
            before_launch: match kind {
                ScriptKind::Utility => PhaseConfig::default(),
                _ => existing.before_launch,
            },
            after_launch: match kind {
                ScriptKind::Utility => PhaseConfig::default(),
                _ => existing.after_launch,
            },
            on_exit: match kind {
                ScriptKind::Utility => PhaseConfig::default(),
                _ => existing.on_exit,
            },
            snippet: match kind {
                ScriptKind::Utility => existing.snippet,
                _ => PhaseConfig::default(),
            },
        };
        if !scripts::update(conn, id, &normalized)? {
            return Err(AppError::other(format!("script {id} not found")));
        }
        scripts::get(conn, id)
    })
}

/// Thin `#[tauri::command]` wrapper delegating to [`list_scripts_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn list_scripts(state: tauri::State<'_, AppState>) -> AppResult<Vec<Script>> {
    list_scripts_impl(&state)
}

/// Thin `#[tauri::command]` wrapper delegating to [`get_script_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn get_script(state: tauri::State<'_, AppState>, id: i64) -> AppResult<Script> {
    get_script_impl(&state, id)
}

/// Thin `#[tauri::command]` wrapper delegating to [`create_script_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn create_script(
    state: tauri::State<'_, AppState>,
    input: ScriptUpsertInput,
) -> AppResult<Script> {
    create_script_impl(&state, input)
}

/// Thin `#[tauri::command]` wrapper delegating to [`update_script_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn update_script(
    state: tauri::State<'_, AppState>,
    id: i64,
    input: ScriptUpsertInput,
) -> AppResult<Script> {
    update_script_impl(&state, id, input)
}

/// Thin `#[tauri::command]` wrapper delegating to [`delete_script_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn delete_script(state: tauri::State<'_, AppState>, id: i64) -> AppResult<()> {
    delete_script_impl(&state, id)
}

/// Thin `#[tauri::command]` wrapper delegating to [`set_script_dependencies_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn set_script_dependencies(
    state: tauri::State<'_, AppState>,
    script_id: i64,
    depends_on: Vec<i64>,
) -> AppResult<Vec<i64>> {
    set_script_dependencies_impl(&state, script_id, depends_on)
}

/// Thin `#[tauri::command]` wrapper delegating to [`set_script_kind_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn set_script_kind(
    state: tauri::State<'_, AppState>,
    id: i64,
    kind: ScriptKind,
) -> AppResult<Script> {
    set_script_kind_impl(&state, id, kind)
}
