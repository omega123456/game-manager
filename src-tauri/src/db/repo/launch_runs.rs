//! Launch-run execution ledger repository.
//!
//! Persists one durable launch run plus its snapshotted script-execution rows.
//! Cleanup retains only the newest run per game so lookups stay bounded.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::{
    LaunchRun, LaunchRunStatus, LaunchScriptRecord, Provenance, ResolvedScript,
    ScriptExecutionStatus, ScriptPhase,
};
use crate::error::{AppError, AppResult};

fn invalid_enum(column: &str, value: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("invalid {column} value '{value}'"),
        )),
    )
}

fn parse_required_utility_names(raw: &str) -> rusqlite::Result<Vec<String>> {
    serde_json::from_str(raw).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(err))
    })
}

fn map_run_row(row: &Row<'_>) -> rusqlite::Result<LaunchRun> {
    let status_raw: String = row.get("status")?;
    let status = status_raw
        .parse::<LaunchRunStatus>()
        .ok()
        .ok_or_else(|| invalid_enum("launch run status", &status_raw))?;
    Ok(LaunchRun {
        id: row.get("id")?,
        game_id: row.get("game_id")?,
        play_session_id: row.get("play_session_id")?,
        status,
        started_at: row.get("started_at")?,
        ended_at: row.get("ended_at")?,
        failure_count: row.get("failure_count")?,
        script_records: Vec::new(),
    })
}

fn map_script_record_row(row: &Row<'_>) -> rusqlite::Result<LaunchScriptRecord> {
    let phase_raw: String = row.get("phase")?;
    let provenance_raw: String = row.get("provenance")?;
    let status_raw: String = row.get("status")?;
    Ok(LaunchScriptRecord {
        id: row.get("id")?,
        launch_run_id: row.get("launch_run_id")?,
        script_id: row.get("script_id")?,
        name: row.get("name")?,
        phase: phase_raw
            .parse::<ScriptPhase>()
            .ok()
            .ok_or_else(|| invalid_enum("script phase", &phase_raw))?,
        provenance: provenance_raw
            .parse::<Provenance>()
            .ok()
            .ok_or_else(|| invalid_enum("script provenance", &provenance_raw))?,
        group_name: row.get("group_name")?,
        order: row.get("order_in_phase")?,
        priority: row.get("priority")?,
        required_utility_names: parse_required_utility_names(
            &row.get::<_, String>("required_utility_names_json")?,
        )?,
        status: status_raw
            .parse::<ScriptExecutionStatus>()
            .ok()
            .ok_or_else(|| invalid_enum("script execution status", &status_raw))?,
        started_at: row.get("started_at")?,
        ended_at: row.get("ended_at")?,
        details: row.get("details")?,
    })
}

fn get_run_row(conn: &Connection, id: i64) -> AppResult<Option<LaunchRun>> {
    conn.query_row(
        "SELECT id, game_id, play_session_id, status, started_at, ended_at, failure_count
         FROM launch_runs
         WHERE id = ?1",
        params![id],
        map_run_row,
    )
    .optional()
    .map_err(AppError::from)
}

fn list_script_records(conn: &Connection, run_id: i64) -> AppResult<Vec<LaunchScriptRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, launch_run_id, script_id, name, phase, provenance, group_name,
                order_in_phase, priority, required_utility_names_json, status,
                started_at, ended_at, details
         FROM launch_run_script_records
         WHERE launch_run_id = ?1
         ORDER BY
           CASE phase
             WHEN 'before' THEN 0
             WHEN 'after' THEN 1
             WHEN 'on_exit' THEN 2
             ELSE 3
           END,
           order_in_phase ASC,
           id ASC",
    )?;
    super::collect_rows(&mut stmt, params![run_id], map_script_record_row)
}

/// Create a fresh active launch run for `game_id`.
pub fn create_run(conn: &Connection, game_id: i64) -> AppResult<LaunchRun> {
    let started_at = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO launch_runs (game_id, status, started_at, failure_count)
         VALUES (?1, ?2, ?3, 0)",
        params![game_id, LaunchRunStatus::Active.to_string(), started_at],
    )?;
    get_run(conn, conn.last_insert_rowid())
}

/// Fetch a single run by id, including its script records.
pub fn get_run(conn: &Connection, id: i64) -> AppResult<LaunchRun> {
    let mut run = get_run_row(conn, id)?
        .ok_or_else(|| AppError::database(format!("launch run {id} not found")))?;
    run.script_records = list_script_records(conn, id)?;
    Ok(run)
}

/// Seed a run's execution ledger from the resolved pipeline snapshot.
pub fn seed_script_records(
    conn: &Connection,
    run_id: i64,
    resolved: &[ResolvedScript],
) -> AppResult<Vec<LaunchScriptRecord>> {
    let mut stmt = conn.prepare(
        "INSERT INTO launch_run_script_records (
           launch_run_id,
           script_id,
           name,
           phase,
           provenance,
           group_name,
           order_in_phase,
           priority,
           required_utility_names_json,
           status
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?;
    for entry in resolved {
        let required_utility_names_json = serde_json::to_string(&entry.required_utility_names)
            .map_err(|err| {
                AppError::database(format!(
                    "serialize required utility names for launch run {run_id}: {err}"
                ))
            })?;
        stmt.execute(params![
            run_id,
            entry.script_id,
            entry.name,
            entry.phase.to_string(),
            entry.provenance.to_string(),
            entry.group_name,
            entry.order,
            entry.priority,
            required_utility_names_json,
            ScriptExecutionStatus::Pending.to_string(),
        ])?;
    }
    list_script_records(conn, run_id)
}

/// Link a run to the play session that was created after process detection.
pub fn link_play_session(conn: &Connection, run_id: i64, play_session_id: i64) -> AppResult<bool> {
    let changed = conn.execute(
        "UPDATE launch_runs SET play_session_id = ?2 WHERE id = ?1",
        params![run_id, play_session_id],
    )?;
    Ok(changed > 0)
}

/// Update a run's durable lifecycle status and summary fields.
pub fn set_run_status(
    conn: &Connection,
    run_id: i64,
    status: LaunchRunStatus,
    failure_count: i64,
    ended_at: Option<&str>,
) -> AppResult<bool> {
    let changed = conn.execute(
        "UPDATE launch_runs
         SET status = ?2,
             failure_count = ?3,
             ended_at = ?4
         WHERE id = ?1",
        params![run_id, status.to_string(), failure_count, ended_at],
    )?;
    Ok(changed > 0)
}

/// Update a single script-record status and any associated timing/detail fields.
pub fn update_script_record_status(
    conn: &Connection,
    record_id: i64,
    status: ScriptExecutionStatus,
    started_at: Option<&str>,
    ended_at: Option<&str>,
    details: Option<&str>,
) -> AppResult<bool> {
    let changed = conn.execute(
        "UPDATE launch_run_script_records
         SET status = ?2,
             started_at = ?3,
             ended_at = ?4,
             details = ?5
         WHERE id = ?1",
        params![record_id, status.to_string(), started_at, ended_at, details],
    )?;
    Ok(changed > 0)
}

/// Read the newest retained run for `game_id`, if any.
pub fn get_latest_run_for_game(conn: &Connection, game_id: i64) -> AppResult<Option<LaunchRun>> {
    let Some(mut run) = conn
        .query_row(
            "SELECT id, game_id, play_session_id, status, started_at, ended_at, failure_count
             FROM launch_runs
             WHERE game_id = ?1
             ORDER BY started_at DESC, id DESC
             LIMIT 1",
            params![game_id],
            map_run_row,
        )
        .optional()?
    else {
        return Ok(None);
    };
    run.script_records = list_script_records(conn, run.id)?;
    Ok(Some(run))
}

/// Delete every run that is not the newest run for its game.
pub fn cleanup_old_runs(conn: &Connection) -> AppResult<usize> {
    let removed = conn.execute(
        "DELETE FROM launch_runs
         WHERE id IN (
           SELECT id FROM (
             SELECT id,
                    ROW_NUMBER() OVER (
                      PARTITION BY game_id
                      ORDER BY started_at DESC, id DESC
                    ) AS row_num
             FROM launch_runs
           )
           WHERE row_num > 1
         )",
        [],
    )?;
    Ok(removed)
}

/// Delete every older run for `game_id`, retaining only `retained_run_id`.
pub fn cleanup_old_runs_for_game(
    conn: &Connection,
    game_id: i64,
    retained_run_id: i64,
) -> AppResult<usize> {
    let removed = conn.execute(
        "DELETE FROM launch_runs
         WHERE game_id = ?1
           AND id != ?2",
        params![game_id, retained_run_id],
    )?;
    Ok(removed)
}
