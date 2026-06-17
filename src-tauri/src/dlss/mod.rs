//! DLSS management domain.
//!
//! Owns all privileged/native DLSS work behind testable functions: the version
//! manifest ([`manifest`]), on-disk storage layout ([`storage`]), folder
//! detection ([`detect`]), downloads ([`download`]), DLL swapping ([`swap`]),
//! elevation handling ([`elevation`]), and the NVAPI preset integration
//! ([`nvapi`]).
//!
//! Phase 1 fully implements `manifest`, `storage`, `elevation`, the NVAPI load
//! probe ([`nvapi::is_nvapi_available`]), and the static preset-option lists.
//! `detect`, `download`, `swap`, and the NVAPI session/profile/preset logic are
//! scaffolded here with their public signatures returning
//! [`DlssError::Unimplemented`]; Phases 2 & 3 fill in the bodies.

pub mod detect;
pub mod download;
pub mod elevation;
pub mod manifest;
pub mod nvapi;
pub mod storage;
pub mod swap;

use crate::error::AppError;

/// Errors raised by the DLSS subsystem.
///
/// Variants map to a readable `AppError` over IPC (see the `From` impl).
/// [`DlssError::Privilege`] and [`DlssError::Unsupported`] are recoverable
/// conditions the frontend handles specially (relaunch-elevated / explain).
#[derive(Debug, thiserror::Error)]
pub enum DlssError {
    /// The operation's body is not yet implemented (Phase 2/3 placeholder).
    #[error("not yet implemented")]
    Unimplemented,

    /// A privileged operation was denied; the app must relaunch as Administrator.
    #[error("administrator privileges are required")]
    Privilege,

    /// The required hardware/driver (NVAPI) is unavailable.
    #[error("NVIDIA NVAPI is unavailable on this system")]
    Unsupported,

    /// A network failure (manifest fetch / download).
    #[error("network error: {0}")]
    Network(String),

    /// A filesystem failure.
    #[error("io error: {0}")]
    Io(String),

    /// A parse/validation failure (manifest JSON, MD5 mismatch, zip contents).
    #[error("{0}")]
    Invalid(String),

    /// A database failure surfaced from the cache repository.
    #[error("database error: {0}")]
    Database(String),
}

/// Convenient alias for results that may fail with [`DlssError`].
pub type DlssResult<T> = Result<T, DlssError>;

impl From<DlssError> for AppError {
    fn from(value: DlssError) -> Self {
        match value {
            DlssError::Database(message) => AppError::Database(message),
            DlssError::Io(message) => AppError::Io(message),
            other => AppError::Other(other.to_string()),
        }
    }
}

impl From<AppError> for DlssError {
    fn from(value: AppError) -> Self {
        match value {
            AppError::Io(message) => DlssError::Io(message),
            AppError::Database(message) => DlssError::Database(message),
            AppError::Other(message) => DlssError::Invalid(message),
        }
    }
}

impl From<std::io::Error> for DlssError {
    fn from(value: std::io::Error) -> Self {
        DlssError::Io(value.to_string())
    }
}

/// Trim a trailing `.0` (repeatedly) from an upstream version so `3.7.0.0`
/// renders as `3.7` (matching DLSS Swapper's display).
pub fn display_version(raw: &str) -> String {
    let mut value = raw.trim();
    while let Some(stripped) = value.strip_suffix(".0") {
        // Keep at least one component (never collapse "0.0" → "").
        if stripped.is_empty() {
            break;
        }
        value = stripped;
    }
    value.to_string()
}
