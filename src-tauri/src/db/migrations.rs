//! Migration runner.
//!
//! Migrations are compiled into the binary via `include_str!` and registered in
//! the [`MIGRATIONS`] array. The runner is idempotent: it tracks the highest
//! applied migration in SQLite's `user_version` pragma and applies only the
//! pending ones, each in its own transaction.

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// A single migration: a stable version number and its SQL body.
pub struct Migration {
    /// 1-based version number; must be contiguous and ascending.
    pub version: i64,
    /// The SQL statements to apply.
    pub sql: &'static str,
}

/// All migrations in application order. Append new entries; never edit shipped ones.
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        sql: include_str!("../../migrations/001_init.sql"),
    },
    Migration {
        version: 2,
        sql: include_str!("../../migrations/002_allow_powershell7.sql"),
    },
];

/// Read the current schema version from `PRAGMA user_version`.
fn current_version(conn: &Connection) -> AppResult<i64> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    Ok(version)
}

/// Apply every pending migration to `conn`. Idempotent across repeated calls.
///
/// Foreign-key enforcement is disabled while migrations run so that schema
/// changes which rebuild a referenced table (create-new / copy / drop-old /
/// rename) do not cascade-delete dependent rows. `PRAGMA foreign_keys` is a
/// no-op inside a transaction, so it must be toggled around the whole loop
/// rather than inside a migration body. After applying, `foreign_key_check`
/// verifies no dangling references were introduced before re-enabling.
pub fn run_migrations(conn: &Connection) -> AppResult<()> {
    let start_version = current_version(conn)?;
    if MIGRATIONS.iter().all(|m| m.version <= start_version) {
        return Ok(());
    }

    conn.pragma_update(None, "foreign_keys", "OFF")?;
    let result = apply_pending(conn, start_version).and_then(|()| verify_foreign_keys(conn));
    // Always re-enable enforcement, even if a migration failed.
    let reenable = conn.pragma_update(None, "foreign_keys", "ON");
    result.and(reenable.map_err(AppError::from))
}

/// Apply each pending migration in its own transaction.
fn apply_pending(conn: &Connection, start_version: i64) -> AppResult<()> {
    let mut version = start_version;
    for migration in MIGRATIONS {
        if migration.version <= version {
            continue;
        }
        conn.execute_batch(&format!(
            "BEGIN; {} PRAGMA user_version = {}; COMMIT;",
            migration.sql, migration.version
        ))?;
        version = migration.version;
    }
    Ok(())
}

/// Fail if any foreign-key reference is left dangling after a rebuild.
fn verify_foreign_keys(conn: &Connection) -> AppResult<()> {
    let violations: i64 =
        conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| row.get(0))?;
    if violations > 0 {
        return Err(AppError::database(format!(
            "migration left {violations} dangling foreign-key reference(s)"
        )));
    }
    Ok(())
}
