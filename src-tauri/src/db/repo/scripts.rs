//! Scripts repository.
//!
//! Read/write helpers returning [`Script`] domain structs, including the three
//! lifecycle-phase column groups, the utility snippet column group, and the
//! `requires` edges from `script_dependencies`. Cycle detection and the
//! utility-target rule are enforced in the command layer (Phase C1), not here.

use rusqlite::{params, Connection, Row};

use crate::domain::{Interpreter, PhaseConfig, PhaseMode, Script, ScriptKind};
use crate::error::{AppError, AppResult};

/// Fields required to create or update a script (excluding `requires` edges).
#[derive(Debug, Clone)]
pub struct NewScript {
    /// Display name.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Mutually-exclusive kind.
    pub kind: ScriptKind,
    /// Priority 1–10 (used by normal/global).
    pub priority: i64,
    /// Before-launch phase.
    pub before_launch: PhaseConfig,
    /// After-process-detected phase.
    pub after_launch: PhaseConfig,
    /// On-exit phase.
    pub on_exit: PhaseConfig,
    /// The single snippet (utility).
    pub snippet: PhaseConfig,
}

fn opt_interpreter(value: Option<String>) -> Option<Interpreter> {
    value.and_then(|v| Interpreter::from_db_str(&v))
}

fn map_phase(
    row: &Row<'_>,
    mode_col: &str,
    path_col: &str,
    inline_col: &str,
    interp_col: &str,
) -> rusqlite::Result<PhaseConfig> {
    let mode_raw: String = row.get(mode_col)?;
    let mode = PhaseMode::from_db_str(&mode_raw).ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(0, mode_col.into(), rusqlite::types::Type::Text)
    })?;
    Ok(PhaseConfig {
        mode,
        path: row.get(path_col)?,
        inline: row.get(inline_col)?,
        interpreter: opt_interpreter(row.get(interp_col)?),
    })
}

fn map_script(row: &Row<'_>) -> rusqlite::Result<Script> {
    let kind_raw: String = row.get("kind")?;
    let kind = ScriptKind::from_db_str(&kind_raw).ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(0, "kind".into(), rusqlite::types::Type::Text)
    })?;
    Ok(Script {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        kind,
        priority: row.get("priority")?,
        before_launch: map_phase(
            row,
            "before_launch_mode",
            "before_launch_path",
            "before_launch_inline",
            "before_launch_interpreter",
        )?,
        after_launch: map_phase(
            row,
            "after_launch_mode",
            "after_launch_path",
            "after_launch_inline",
            "after_launch_interpreter",
        )?,
        on_exit: map_phase(
            row,
            "on_exit_mode",
            "on_exit_path",
            "on_exit_inline",
            "on_exit_interpreter",
        )?,
        snippet: map_phase(
            row,
            "snippet_mode",
            "snippet_path",
            "snippet_inline",
            "snippet_interpreter",
        )?,
        created_at: row.get("created_at")?,
        // Filled in after the row read via require_ids().
        requires: Vec::new(),
    })
}

fn interp_db(phase: &PhaseConfig) -> Option<&'static str> {
    phase.interpreter.map(Interpreter::as_db_str)
}

/// Insert a new script and return its assigned id. Does not set `requires` edges.
pub fn create(conn: &Connection, script: &NewScript) -> AppResult<i64> {
    let created_at = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO scripts (
            name, description, kind, priority,
            before_launch_mode, before_launch_path, before_launch_inline, before_launch_interpreter,
            after_launch_mode, after_launch_path, after_launch_inline, after_launch_interpreter,
            on_exit_mode, on_exit_path, on_exit_inline, on_exit_interpreter,
            snippet_mode, snippet_path, snippet_inline, snippet_interpreter,
            created_at
        ) VALUES (
            ?1, ?2, ?3, ?4,
            ?5, ?6, ?7, ?8,
            ?9, ?10, ?11, ?12,
            ?13, ?14, ?15, ?16,
            ?17, ?18, ?19, ?20,
            ?21
        )",
        params![
            script.name,
            script.description,
            script.kind.as_db_str(),
            script.priority,
            script.before_launch.mode.as_db_str(),
            script.before_launch.path,
            script.before_launch.inline,
            interp_db(&script.before_launch),
            script.after_launch.mode.as_db_str(),
            script.after_launch.path,
            script.after_launch.inline,
            interp_db(&script.after_launch),
            script.on_exit.mode.as_db_str(),
            script.on_exit.path,
            script.on_exit.inline,
            interp_db(&script.on_exit),
            script.snippet.mode.as_db_str(),
            script.snippet.path,
            script.snippet.inline,
            interp_db(&script.snippet),
            created_at,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Update mutable fields of a script (excluding `requires`). Returns whether changed.
pub fn update(conn: &Connection, id: i64, script: &NewScript) -> AppResult<bool> {
    let changed = conn.execute(
        "UPDATE scripts SET
            name = ?2, description = ?3, kind = ?4, priority = ?5,
            before_launch_mode = ?6, before_launch_path = ?7, before_launch_inline = ?8, before_launch_interpreter = ?9,
            after_launch_mode = ?10, after_launch_path = ?11, after_launch_inline = ?12, after_launch_interpreter = ?13,
            on_exit_mode = ?14, on_exit_path = ?15, on_exit_inline = ?16, on_exit_interpreter = ?17,
            snippet_mode = ?18, snippet_path = ?19, snippet_inline = ?20, snippet_interpreter = ?21
         WHERE id = ?1",
        params![
            id,
            script.name,
            script.description,
            script.kind.as_db_str(),
            script.priority,
            script.before_launch.mode.as_db_str(),
            script.before_launch.path,
            script.before_launch.inline,
            interp_db(&script.before_launch),
            script.after_launch.mode.as_db_str(),
            script.after_launch.path,
            script.after_launch.inline,
            interp_db(&script.after_launch),
            script.on_exit.mode.as_db_str(),
            script.on_exit.path,
            script.on_exit.inline,
            interp_db(&script.on_exit),
            script.snippet.mode.as_db_str(),
            script.snippet.path,
            script.snippet.inline,
            interp_db(&script.snippet),
        ],
    )?;
    Ok(changed > 0)
}

/// The ascending list of utility-script ids this script requires.
pub fn require_ids(conn: &Connection, script_id: i64) -> AppResult<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT depends_on_script_id FROM script_dependencies
         WHERE script_id = ?1 ORDER BY depends_on_script_id",
    )?;
    super::collect_ids(&mut stmt, params![script_id])
}

/// Replace the `requires` edges for a script. Validation/cycle checks belong in C1.
pub fn set_dependencies(conn: &Connection, script_id: i64, depends_on: &[i64]) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM script_dependencies WHERE script_id = ?1",
        params![script_id],
    )?;
    for dep in depends_on {
        tx.execute(
            "INSERT INTO script_dependencies (script_id, depends_on_script_id) VALUES (?1, ?2)",
            params![script_id, dep],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Update only a script's kind. Returns whether a row changed.
pub fn set_kind(conn: &Connection, id: i64, kind: ScriptKind) -> AppResult<bool> {
    let changed = conn.execute(
        "UPDATE scripts SET kind = ?2 WHERE id = ?1",
        params![id, kind.as_db_str()],
    )?;
    Ok(changed > 0)
}

/// List all scripts (with `requires` populated) ordered by name.
pub fn list(conn: &Connection) -> AppResult<Vec<Script>> {
    let mut stmt = conn.prepare("SELECT * FROM scripts ORDER BY name COLLATE NOCASE")?;
    let mut scripts = super::collect_rows(&mut stmt, [], map_script)?;
    for script in &mut scripts {
        script.requires = require_ids(conn, script.id)?;
    }
    Ok(scripts)
}

/// Fetch a single script (with `requires` populated) by id.
pub fn get(conn: &Connection, id: i64) -> AppResult<Script> {
    let mut stmt = conn.prepare("SELECT * FROM scripts WHERE id = ?1")?;
    let mut rows = stmt.query_map(params![id], map_script)?;
    match rows.next() {
        Some(row) => {
            let mut script = row?;
            script.requires = require_ids(conn, script.id)?;
            Ok(script)
        }
        None => Err(AppError::database(format!("script {id} not found"))),
    }
}

/// Delete a script by id. Returns whether it existed.
pub fn delete(conn: &Connection, id: i64) -> AppResult<bool> {
    let changed = conn.execute("DELETE FROM scripts WHERE id = ?1", params![id])?;
    Ok(changed > 0)
}
