//! Migration runner.
//!
//! Migrations are compiled into the binary via `include_str!` and registered in
//! the [`MIGRATIONS`] array. The runner is idempotent: it tracks the highest
//! applied migration in SQLite's `user_version` pragma and applies only the
//! pending ones, each in its own transaction.

use rusqlite::Connection;

use crate::error::AppResult;

/// A single migration: a stable version number and its SQL body.
pub struct Migration {
    /// 1-based version number; must be contiguous and ascending.
    pub version: i64,
    /// The SQL statements to apply.
    pub sql: &'static str,
}

/// All migrations in application order. Append new entries; never edit shipped ones.
pub const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    sql: include_str!("../../migrations/001_init.sql"),
}];

/// Read the current schema version from `PRAGMA user_version`.
fn current_version(conn: &Connection) -> AppResult<i64> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    Ok(version)
}

/// Apply every pending migration to `conn`. Idempotent across repeated calls.
pub fn run_migrations(conn: &Connection) -> AppResult<()> {
    let mut version = current_version(conn)?;
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
