//! NVAPI preset feature surface.
//!
//! Phase 1 implemented [`preset_options`] (the bundled SR / RR option lists).
//! Phase 3 fills the live get/set of global and per-game presets against the
//! [`NvapiDrs`](super::ffi::NvapiDrs) abstraction.
//!
//! Design:
//! * Global presets target the **base** profile.
//! * Per-game presets target a **matched existing app profile** only (no profile
//!   creation); when none matches the surface reports `available: false`.
//! * NVAPI absent → [`DlssError::Unsupported`] (a normal, recoverable condition,
//!   not a hard error); the matched-profile lookup never erroring is what lets a
//!   present-but-unmatched game report unavailability instead.
//! * Setting saves require elevation; the driver surfaces [`DlssError::Privilege`].
//! * Presets are read live (never cached into `GameDlssState`).

use serde::Deserialize;

use crate::domain::{GamePresetState, PresetKind, PresetOption};
use crate::dlss::nvapi::drs::real_nvapi_drs;
use crate::dlss::nvapi::ffi::{NvapiDrs, SETTING_ID_DLSS_RR, SETTING_ID_DLSS_SR};
use crate::dlss::{DlssError, DlssResult};
use crate::state::AppState;

/// Bundled DLSS SR preset options.
const SR_PRESETS: &str = include_str!("../../../assets/dlss_presets.json");
/// Bundled DLSS RR preset options.
const RR_PRESETS: &str = include_str!("../../../assets/dlss_d_presets.json");

/// The raw bundled preset-option record.
#[derive(Debug, Deserialize)]
struct RawPreset {
    value: u32,
    name: String,
    #[serde(default)]
    deprecated: bool,
}

/// Return the bundled preset options for the given kind.
pub fn preset_options(kind: PresetKind) -> DlssResult<Vec<PresetOption>> {
    let body = match kind {
        PresetKind::Dlss => SR_PRESETS,
        PresetKind::RayReconstruction => RR_PRESETS,
    };
    let raw: Vec<RawPreset> = serde_json::from_str(body)
        .map_err(|err| DlssError::Invalid(format!("parse preset options: {err}")))?;
    Ok(raw
        .into_iter()
        .map(|preset| PresetOption {
            value: preset.value,
            name: preset.name,
            deprecated: preset.deprecated,
        })
        .collect())
}

/// The NVAPI DRS setting id backing a [`PresetKind`].
pub fn setting_id(kind: PresetKind) -> u32 {
    match kind {
        PresetKind::Dlss => SETTING_ID_DLSS_SR,
        PresetKind::RayReconstruction => SETTING_ID_DLSS_RR,
    }
}

// ---------------------------------------------------------------------------
// Pure orchestration over `NvapiDrs` (testable against a fake driver).
// ---------------------------------------------------------------------------

/// Read the global (base profile) preset value over `drs`. An unset setting
/// reads as `Default` (`0`).
pub fn get_global_preset_with(drs: &dyn NvapiDrs, kind: PresetKind) -> DlssResult<u32> {
    Ok(drs.get_base_setting(setting_id(kind))?.unwrap_or(0))
}

/// Write the global (base profile) preset value over `drs`.
pub fn set_global_preset_with(drs: &dyn NvapiDrs, kind: PresetKind, value: u32) -> DlssResult<()> {
    drs.set_base_setting(setting_id(kind), value)
}

/// Read the per-game preset state over `drs`, translating "no matched profile"
/// into `available: false` (value `Default`).
pub fn get_game_preset_with(
    drs: &dyn NvapiDrs,
    game_name: &str,
    exe_names: &[String],
    kind: PresetKind,
) -> DlssResult<GamePresetState> {
    match drs.get_app_setting(game_name, exe_names, setting_id(kind))? {
        Some(value) => Ok(GamePresetState {
            available: true,
            value,
        }),
        None => Ok(GamePresetState {
            available: false,
            value: 0,
        }),
    }
}

/// Write the per-game preset value over `drs`. A missing matched profile is a
/// no-op success (the per-game surface is unavailable, not an error).
pub fn set_game_preset_with(
    drs: &dyn NvapiDrs,
    game_name: &str,
    exe_names: &[String],
    kind: PresetKind,
    value: u32,
) -> DlssResult<bool> {
    drs.set_app_setting(game_name, exe_names, setting_id(kind), value)
}

// ---------------------------------------------------------------------------
// Game identity resolution (name + candidate exe names) from the DB.
// ---------------------------------------------------------------------------

/// Resolve a game's display name and the candidate `.exe` file names used for
/// per-game profile matching: the launch target and (when set) the named
/// monitor process. Names are normalised to lowercase base file names downstream.
pub fn game_identity(state: &AppState, game_id: i64) -> DlssResult<(String, Vec<String>)> {
    let game = state.with_db(|conn| crate::db::repo::games::get(conn, game_id))?;
    let dlss_cached = state.with_db(|conn| crate::db::repo::dlss::get(conn, game_id))?;
    let mut exe_names = Vec::new();
    let folder_override = dlss_cached.as_ref().and_then(|cached| cached.folder_override.clone());
    let resolved_folder =
        crate::dlss::detect::resolve_folder(folder_override.as_deref(), &game.launch_target);
    if let Some(folder) = resolved_folder.as_ref() {
        push_folder_exes(&mut exe_names, folder);
    }
    push_exe(&mut exe_names, &game.launch_target);
    if let Some(process) = game.monitor_process_name.as_deref() {
        push_exe(&mut exe_names, process);
    }
    tracing::info!(
        category = "dlss",
        game_id,
        game_name = %game.name,
        launch_target = %game.launch_target,
        folder_override = ?folder_override,
        resolved_folder = ?resolved_folder.as_ref().map(|path| path.to_string_lossy().to_string()),
        monitor_process_name = ?game.monitor_process_name,
        detected_sr_path = ?dlss_cached
            .as_ref()
            .and_then(|cached| cached.super_resolution.as_ref().map(|dll| dll.path.as_str())),
        detected_fg_path = ?dlss_cached
            .as_ref()
            .and_then(|cached| cached.frame_generation.as_ref().map(|dll| dll.path.as_str())),
        detected_rr_path = ?dlss_cached
            .as_ref()
            .and_then(|cached| cached.ray_reconstruction.as_ref().map(|dll| dll.path.as_str())),
        candidate_exe_count = exe_names.len(),
        candidate_exes = ?exe_names,
        "nvapi profile match: resolved game identity"
    );
    Ok((game.name, exe_names))
}

fn push_folder_exes(out: &mut Vec<String>, folder: &std::path::Path) {
    let mut stack = vec![folder.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            push_exe(out, name);
        }
    }
}

/// Append a candidate exe file name (deduplicated, non-empty) for matching.
fn push_exe(out: &mut Vec<String>, raw: &str) {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return;
    }
    let name = std::path::Path::new(trimmed)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| trimmed.to_string());
    let lower = name.to_lowercase();
    if !lower.ends_with(".exe") {
        return;
    }
    if !out.iter().any(|existing| existing.to_lowercase() == lower) {
        out.push(name);
    }
}

// ---------------------------------------------------------------------------
// Per-game orchestration over a resolved `NvapiDrs` (state + drs → result).
//
// These combine DB game-identity resolution with the per-game `*_with` helpers
// so the full per-game flow is testable against a fake driver without a GPU.
// ---------------------------------------------------------------------------

/// Resolve the game identity, then read its per-game preset over `drs`.
pub fn get_game_preset_for(
    drs: &dyn NvapiDrs,
    state: &AppState,
    game_id: i64,
    kind: PresetKind,
) -> DlssResult<GamePresetState> {
    let (name, exe_names) = game_identity(state, game_id)?;
    let preset = get_game_preset_with(drs, &name, &exe_names, kind)?;
    tracing::info!(
        category = "dlss",
        game_id,
        game_name = %name,
        preset_kind = ?kind,
        available = preset.available,
        value = preset.value,
        "nvapi per-game preset read"
    );
    Ok(preset)
}

/// Resolve the game identity, then write its per-game preset over `drs`. Logs an
/// info line (and reports no error) when no driver profile matches.
pub fn set_game_preset_for(
    drs: &dyn NvapiDrs,
    state: &AppState,
    game_id: i64,
    kind: PresetKind,
    value: u32,
) -> DlssResult<()> {
    let (name, exe_names) = game_identity(state, game_id)?;
    if !set_game_preset_with(drs, &name, &exe_names, kind, value)? {
        tracing::info!(
            category = "dlss",
            "no matching driver profile for game {game_id}; per-game preset not applied"
        );
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Command impls (build the real driver, then delegate to the testable layer).
//
// The only line each `_impl` adds over the tested orchestration is constructing
// the real `nvapi64.dll`-backed driver — the genuine runtime/driver boundary
// (returns `Unsupported` with no NVIDIA driver / under coverage).
// ---------------------------------------------------------------------------

/// Read the global (base profile) preset value.
pub fn get_global_preset_impl(_state: &AppState, kind: PresetKind) -> DlssResult<u32> {
    tracing::info!(
        category = "dlss",
        preset_kind = ?kind,
        "dlss_get_global_preset: reading base profile"
    );
    get_global_preset_with(real_nvapi_drs()?.as_ref(), kind)
}

/// Write the global (base profile) preset value.
pub fn set_global_preset_impl(_state: &AppState, kind: PresetKind, value: u32) -> DlssResult<()> {
    set_global_preset_with(real_nvapi_drs()?.as_ref(), kind, value)
}

/// Read the per-game preset state.
pub fn get_game_preset_impl(
    state: &AppState,
    game_id: i64,
    kind: PresetKind,
) -> DlssResult<GamePresetState> {
    tracing::info!(
        category = "dlss",
        game_id,
        preset_kind = ?kind,
        "dlss_get_game_preset: starting nvapi profile match"
    );
    get_game_preset_for(real_nvapi_drs()?.as_ref(), state, game_id, kind)
}

/// Write the per-game preset value (no-op when no profile matches).
pub fn set_game_preset_impl(
    state: &AppState,
    game_id: i64,
    kind: PresetKind,
    value: u32,
) -> DlssResult<()> {
    set_game_preset_for(real_nvapi_drs()?.as_ref(), state, game_id, kind, value)
}
