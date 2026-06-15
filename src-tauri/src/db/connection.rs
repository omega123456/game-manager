//! SQLite connection setup.
//!
//! Every connection is opened with the project's required pragmas:
//! `journal_mode = WAL`, `foreign_keys = ON`, `auto_vacuum = INCREMENTAL`.
//! `auto_vacuum` must be set before any table is created (it is a no-op on an
//! already-populated database), so it is applied immediately on open.

use rusqlite::Connection;

use crate::error::AppResult;

/// Apply the standard pragmas to a freshly opened connection.
fn configure(conn: &Connection) -> AppResult<()> {
    // auto_vacuum must be set before tables exist; pragma_update runs it eagerly.
    conn.pragma_update(None, "auto_vacuum", "INCREMENTAL")?;
    // WAL is a no-op for in-memory databases but harmless; ignore its returned row.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(())
}

/// Open an on-disk SQLite database at `path`, configured and migrated.
pub fn open(path: &std::path::Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    crate::db::migrations::run_migrations(&conn)?;
    Ok(conn)
}

/// Open an in-memory SQLite database, configured and migrated.
///
/// Used by tests and by callers that need a throwaway database.
pub fn open_in_memory() -> AppResult<Connection> {
    let conn = Connection::open_in_memory()?;
    configure(&conn)?;
    crate::db::migrations::run_migrations(&conn)?;
    Ok(conn)
}
