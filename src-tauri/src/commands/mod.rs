//! Tauri command wrappers.
//!
//! Each command is a thin `#[tauri::command]` that delegates to a testable
//! `*_impl(state: &AppState, ...)`. Wrappers are registered in
//! `tauri::generate_handler!` (see `lib.rs`) and granted via
//! `permissions/*.toml` + `capabilities/default.json`. Phase A2 ships only the
//! logging command; domain commands land in later phases.

pub mod art;
pub mod games;
pub mod groups;
pub mod logging;
pub mod scripts;
pub mod settings;
