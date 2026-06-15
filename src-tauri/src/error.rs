//! Application error type.
//!
//! `AppError` is the single error type returned by command `*_impl` functions
//! and the supporting modules. It serializes to a plain string over IPC so the
//! frontend receives a readable message.

use serde::{Serialize, Serializer};

/// The application-wide error type.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// A failure originating from an underlying I/O operation.
    #[error("io error: {0}")]
    Io(String),

    /// A failure originating from the database layer (introduced in Phase A2).
    #[error("database error: {0}")]
    Database(String),

    /// A generic, caller-supplied failure message.
    #[error("{0}")]
    Other(String),
}

impl AppError {
    /// Construct an `Other` error from any displayable value.
    pub fn other(message: impl Into<String>) -> Self {
        AppError::Other(message.into())
    }

    /// Construct a `Database` error from any displayable value.
    pub fn database(message: impl Into<String>) -> Self {
        AppError::Database(message.into())
    }
}

/// Bridge `rusqlite` failures into the application error type.
impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        AppError::Database(value.to_string())
    }
}

/// Serialize as the error's `Display` string so the frontend gets a readable message.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// Convenient alias for results that may fail with [`AppError`].
pub type AppResult<T> = Result<T, AppError>;
