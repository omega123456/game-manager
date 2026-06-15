//! Database layer: connection setup, migration runner, and repositories.
//!
//! SQLite (via `rusqlite`) is the single source of truth. Connections are opened
//! in WAL mode with `foreign_keys = ON` and `auto_vacuum = INCREMENTAL`, then
//! migrated via the `include_str!`-based [`migrations`] runner. Per-domain
//! repositories in [`repo`] return domain structs.

pub mod connection;
pub mod migrations;
pub mod repo;
