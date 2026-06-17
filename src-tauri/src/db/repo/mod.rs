//! Per-domain repositories.
//!
//! Each module exposes read/write helpers returning domain structs. Repositories
//! contain no Tauri command handlers — those live in `crate::commands` and are
//! introduced in later phases.

pub mod dlss;
pub mod games;
pub mod groups;
pub mod logs;
pub mod scripts;
pub mod sessions;
pub mod settings;

use rusqlite::{Params, Row, Statement};

use crate::error::AppResult;

/// Run a prepared statement and collect every mapped row into a `Vec`.
///
/// Centralizes the prepare→query_map→collect pattern (and its single error
/// propagation point) shared by the list-style repository helpers.
pub(crate) fn collect_rows<T, P, F>(
    stmt: &mut Statement<'_>,
    params: P,
    map: F,
) -> AppResult<Vec<T>>
where
    P: Params,
    F: FnMut(&Row<'_>) -> rusqlite::Result<T>,
{
    let rows = stmt.query_map(params, map)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Collect a single column of `i64` ids from a prepared statement.
pub(crate) fn collect_ids<P: Params>(stmt: &mut Statement<'_>, params: P) -> AppResult<Vec<i64>> {
    collect_rows(stmt, params, |row| row.get(0))
}
