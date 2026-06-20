//! DLSS management commands.
//!
//! The full IPC contract for the DLSS feature. Every command is a thin
//! `#[tauri::command]` wrapper delegating to a testable `*_impl(&AppState, ...)`
//! (or directly to a `dlss::*` module function). Cached-read commands
//! (support, catalog, state reads, preset options, folder override, count,
//! relaunch) are fully implemented here in Phase 1; commands whose logic lands
//! in Phase 2 (detect/download/swap) or Phase 3 (NVAPI presets) call module
//! functions that currently return `DlssError::Unimplemented` and will "light
//! up" as those phases fill in the bodies.
//!
//! **Phases 2 & 3 must NOT edit this file** — the contract is fixed here.

#[cfg(not(coverage))]
use crate::dlss::download::{download_version_impl, ProgressSink};
#[cfg(not(coverage))]
use crate::dlss::swap::{apply_to_all_impl, ApplyProgressSink};
use crate::dlss::swap::{apply_to_game_impl, SwapTarget};
use crate::dlss::{detect, elevation, nvapi, swap};
#[cfg(not(coverage))]
use crate::dlss::{download, manifest};
#[cfg(not(coverage))]
use crate::domain::{BatchApplyResult, DllCatalog, GamePresetState};
use crate::domain::{
    DllType, DlssIndicatorMode, DlssSupport, GameDlssState, PresetKind, PresetOption,
    SaveGameDllSelection, SaveGameDlss,
};
use crate::error::AppResult;
use crate::state::AppState;

/// Tauri event channel for streamed download progress.
pub const EVENT_DOWNLOAD_PROGRESS: &str = "dlss://download-progress";
/// Tauri event channel for per-game batch-apply progress.
pub const EVENT_APPLY_PROGRESS: &str = "dlss://apply-progress";
/// Tauri event emitted once the startup library scan finishes, so the frontend
/// can refetch the (session-only) detection that drives the library pills.
pub const EVENT_LIBRARY_SCANNED: &str = "dlss://library-scanned";

#[cfg(not(coverage))]
static LIBRARY_SCAN_RUNNING: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[cfg(not(coverage))]
fn emit_library_scanned(app: &tauri::AppHandle) {
    use tauri::Emitter;

    if let Err(err) = app.emit(EVENT_LIBRARY_SCANNED, ()) {
        tracing::warn!(
            category = "dlss",
            "emit dlss library-scanned event failed: {err}"
        );
    }
}

/// Run the blocking filesystem/hash scan away from Tauri's command executor.
#[cfg(not(coverage))]
async fn scan_library_blocking(app: tauri::AppHandle) -> AppResult<Vec<GameDlssState>> {
    use std::sync::atomic::Ordering;

    if LIBRARY_SCAN_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        use tauri::Manager;

        tracing::debug!(
            category = "dlss",
            "dlss library scan already running; returning cached state"
        );
        let state = app.state::<AppState>();
        return list_game_states_impl(&state);
    }

    let scan_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;

        let state = scan_app.state::<AppState>();
        detect::scan_library_impl(&state).map_err(crate::error::AppError::from)
    })
    .await;

    LIBRARY_SCAN_RUNNING.store(false, Ordering::Release);
    let result = result.map_err(|err| {
        crate::error::AppError::other(format!("dlss library scan task failed: {err}"))
    })?;
    emit_library_scanned(&app);
    result
}

/// Start a full library scan without waiting for it. Used during startup so
/// slow recursive DLL reads never delay the main window becoming interactive.
#[cfg(not(coverage))]
pub fn spawn_library_scan(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(err) = scan_library_blocking(app).await {
            tracing::warn!(
                category = "dlss",
                "background DLSS library scan failed: {err}"
            );
        }
    });
}

// ---------------------------------------------------------------------------
// Testable impls (Phase 1 fully-implemented surface).
// ---------------------------------------------------------------------------

/// Platform capability flags: NVAPI availability + elevation state.
pub fn get_support_impl() -> DlssSupport {
    let support = DlssSupport {
        nvapi_available: nvapi::is_nvapi_available(),
        is_elevated: elevation::is_elevated(),
    };
    tracing::debug!(
        category = "dlss",
        nvapi_available = support.nvapi_available,
        is_elevated = support.is_elevated,
        "dlss_get_support"
    );
    support
}

/// Read the cached DLSS state for `game_id`.
///
/// Returns a default (empty, `stale = true`) state when no row exists yet so the
/// frontend can render a "needs scan" affordance without a NULL result.
pub fn get_game_state_impl(state: &AppState, game_id: i64) -> AppResult<GameDlssState> {
    let folder_override =
        state.with_db(|conn| crate::db::repo::dlss::get_folder_override(conn, game_id))?;
    let detection = state.dlss_detection_get(game_id);
    let cache_hit = detection.is_some();
    let result = detect::build_game_state(game_id, folder_override, detection);
    tracing::debug!(
        category = "dlss",
        game_id,
        cache_hit,
        stale = result.stale,
        has_sr = result.super_resolution.is_some(),
        has_fg = result.frame_generation.is_some(),
        has_rr = result.ray_reconstruction.is_some(),
        folder_override = ?result.folder_override,
        "dlss_get_game_state: in-memory detection read (no folder scan)"
    );
    Ok(result)
}

/// List every game's DLSS state (drives library pills) from the session detection
/// cache, merged with durable folder overrides. No NVAPI, no scanning.
pub fn list_game_states_impl(state: &AppState) -> AppResult<Vec<GameDlssState>> {
    use std::collections::BTreeMap;

    let overrides: std::collections::HashMap<i64, String> = state
        .with_db(crate::db::repo::dlss::list_folder_overrides)?
        .into_iter()
        .collect();

    // Union of game ids that have a session detection or a stored override.
    let mut detections: BTreeMap<i64, Option<detect::DetectionResult>> = BTreeMap::new();
    for (game_id, detection) in state.dlss_detection_snapshot() {
        detections.insert(game_id, Some(detection));
    }
    for game_id in overrides.keys() {
        detections.entry(*game_id).or_insert(None);
    }

    let states: Vec<GameDlssState> = detections
        .into_iter()
        .map(|(game_id, detection)| {
            detect::build_game_state(game_id, overrides.get(&game_id).cloned(), detection)
        })
        .collect();

    let with_dll = states
        .iter()
        .filter(|state| {
            state.super_resolution.is_some()
                || state.frame_generation.is_some()
                || state.ray_reconstruction.is_some()
        })
        .count();
    tracing::debug!(
        category = "dlss",
        count = states.len(),
        with_dll,
        "dlss_list_game_states: in-memory detection read (no folder scan)"
    );
    Ok(states)
}

/// Set (or clear) a game's folder override and return its refreshed cached state.
pub fn set_folder_override_impl(
    state: &AppState,
    game_id: i64,
    folder: Option<&str>,
) -> AppResult<GameDlssState> {
    let folder = folder.map(str::trim).filter(|value| !value.is_empty());
    state.with_db(|conn| crate::db::repo::dlss::set_folder_override(conn, game_id, folder))?;
    get_game_state_impl(state, game_id)
}

/// Count games where `dll_type` is currently detected.
pub fn count_applicable_impl(state: &AppState, dll_type: DllType) -> AppResult<u32> {
    Ok(swap::count_applicable_impl(state, dll_type)?)
}

/// Bundled preset options for the given kind.
pub fn get_preset_options_impl(kind: PresetKind) -> AppResult<Vec<PresetOption>> {
    Ok(nvapi::presets::preset_options(kind)?)
}

/// Read the global NVIDIA DLSS indicator mode.
pub fn get_global_indicator_impl() -> AppResult<DlssIndicatorMode> {
    Ok(crate::dlss::indicator::get_global_indicator_mode_impl()?)
}

/// Write the global NVIDIA DLSS indicator mode.
pub fn set_global_indicator_impl(mode: DlssIndicatorMode) -> AppResult<()> {
    Ok(crate::dlss::indicator::set_global_indicator_mode_impl(
        mode,
    )?)
}

// ---------------------------------------------------------------------------
// Tauri command wrappers.
// ---------------------------------------------------------------------------

/// A [`ProgressSink`] / [`ApplyProgressSink`] backed by a Tauri `AppHandle`.
#[cfg(not(coverage))]
struct TauriDlssSink {
    app: tauri::AppHandle,
}

#[cfg(not(coverage))]
impl ProgressSink for TauriDlssSink {
    fn emit(&self, progress: &crate::domain::DownloadProgress) {
        use tauri::Emitter;
        if let Err(err) = self.app.emit(EVENT_DOWNLOAD_PROGRESS, progress) {
            tracing::warn!(category = "dlss", "emit download progress failed: {err}");
        }
    }
}

#[cfg(not(coverage))]
impl ApplyProgressSink for TauriDlssSink {
    fn emit(&self, result: &crate::domain::ApplyResult) {
        use tauri::Emitter;
        if let Err(err) = self.app.emit(EVENT_APPLY_PROGRESS, result) {
            tracing::warn!(category = "dlss", "emit apply progress failed: {err}");
        }
    }
}

/// NVAPI availability + elevation state.
#[cfg(not(coverage))]
#[tauri::command]
pub fn dlss_get_support() -> DlssSupport {
    get_support_impl()
}

/// Resolve the version catalog (cached, or refreshed from upstream).
#[cfg(not(coverage))]
#[tauri::command]
pub async fn dlss_get_catalog(
    state: tauri::State<'_, AppState>,
    refresh: bool,
) -> AppResult<DllCatalog> {
    Ok(manifest::resolve_catalog(&state, refresh).await?)
}

/// Cached per-game DLSS state.
#[cfg(not(coverage))]
#[tauri::command]
pub fn dlss_get_game_state(
    state: tauri::State<'_, AppState>,
    game_id: i64,
) -> AppResult<GameDlssState> {
    get_game_state_impl(&state, game_id)
}

/// Cached states for the whole library.
#[cfg(not(coverage))]
#[tauri::command]
pub fn dlss_list_game_states(state: tauri::State<'_, AppState>) -> AppResult<Vec<GameDlssState>> {
    list_game_states_impl(&state)
}

/// Force a re-scan of one game (Phase 2 logic).
#[cfg(not(coverage))]
#[tauri::command]
pub async fn dlss_scan_game(app: tauri::AppHandle, game_id: i64) -> AppResult<GameDlssState> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;

        let state = app.state::<AppState>();
        detect::scan_game_impl(&state, game_id).map_err(crate::error::AppError::from)
    })
    .await
    .map_err(|err| crate::error::AppError::other(format!("dlss game scan task failed: {err}")))?
}

/// Re-scan all applicable games (Phase 2 logic).
#[cfg(not(coverage))]
#[tauri::command]
pub async fn dlss_scan_library(app: tauri::AppHandle) -> AppResult<Vec<GameDlssState>> {
    scan_library_blocking(app).await
}

/// Set (or clear) a game's folder override.
#[cfg(not(coverage))]
#[tauri::command]
pub fn dlss_set_folder_override(
    state: tauri::State<'_, AppState>,
    game_id: i64,
    folder: Option<String>,
) -> AppResult<GameDlssState> {
    set_folder_override_impl(&state, game_id, folder.as_deref())?;
    // Re-scan immediately so detection reflects the new folder without a restart.
    Ok(detect::scan_game_impl(&state, game_id)?)
}

/// Download a version (Phase 2 logic), emitting `dlss://download-progress`.
#[cfg(not(coverage))]
#[tauri::command]
pub async fn dlss_download_version(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    dll_type: DllType,
    version: String,
) -> AppResult<()> {
    let sink = TauriDlssSink { app: app.clone() };
    download_version_impl(&state, dll_type, &version, &sink).await?;
    Ok(())
}

/// Cancel an in-flight download (Phase 2 logic).
#[cfg(not(coverage))]
#[tauri::command]
pub fn dlss_cancel_download(
    state: tauri::State<'_, AppState>,
    dll_type: DllType,
    version: String,
) -> AppResult<()> {
    Ok(download::cancel_download_impl(&state, dll_type, &version)?)
}

/// Apply a version (or restore the System Default) to one game (Phase 2 logic).
#[cfg(not(coverage))]
#[tauri::command]
pub async fn dlss_apply_to_game(
    state: tauri::State<'_, AppState>,
    game_id: i64,
    dll_type: DllType,
    version: Option<String>,
) -> AppResult<GameDlssState> {
    let target = match version {
        Some(version) => SwapTarget::Version(version),
        None => SwapTarget::SystemDefault,
    };
    Ok(apply_to_game_impl(&state, game_id, dll_type, target).await?)
}

/// Apply a version to all applicable games (Phase 2 logic), emitting
/// `dlss://apply-progress` per game.
#[cfg(not(coverage))]
#[tauri::command]
pub async fn dlss_apply_to_all(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    dll_type: DllType,
    version: String,
) -> AppResult<BatchApplyResult> {
    let sink = TauriDlssSink { app: app.clone() };
    Ok(apply_to_all_impl(&state, dll_type, &version, &sink).await?)
}

/// Count games where `dll_type` is detected.
#[cfg(not(coverage))]
#[tauri::command]
pub fn dlss_count_applicable(
    state: tauri::State<'_, AppState>,
    dll_type: DllType,
) -> AppResult<u32> {
    count_applicable_impl(&state, dll_type)
}

/// Bundled preset options for the given kind.
#[cfg(not(coverage))]
#[tauri::command]
pub fn dlss_get_preset_options(preset_kind: PresetKind) -> AppResult<Vec<PresetOption>> {
    get_preset_options_impl(preset_kind)
}

/// Read the global DLSS on-screen indicator mode.
#[cfg(not(coverage))]
#[tauri::command]
pub fn dlss_get_global_indicator() -> AppResult<DlssIndicatorMode> {
    get_global_indicator_impl()
}

/// Write the global DLSS on-screen indicator mode.
#[cfg(not(coverage))]
#[tauri::command]
pub fn dlss_set_global_indicator(mode: DlssIndicatorMode) -> AppResult<()> {
    set_global_indicator_impl(mode)
}

/// Read the global (base profile) preset value (Phase 3 logic).
///
/// `async` so the NVAPI session work (which previously ran on the main/UI thread
/// and froze the window) is dispatched to the async runtime instead.
#[cfg(not(coverage))]
#[tauri::command]
pub async fn dlss_get_global_preset(
    state: tauri::State<'_, AppState>,
    preset_kind: PresetKind,
) -> AppResult<u32> {
    Ok(nvapi::presets::get_global_preset_impl(&state, preset_kind)?)
}

/// Write the global (base profile) preset value (Phase 3 logic).
#[cfg(not(coverage))]
#[tauri::command]
pub async fn dlss_set_global_preset(
    state: tauri::State<'_, AppState>,
    preset_kind: PresetKind,
    value: u32,
) -> AppResult<()> {
    Ok(nvapi::presets::set_global_preset_impl(
        &state,
        preset_kind,
        value,
    )?)
}

/// Read the per-game preset state (Phase 3 logic).
///
/// `async` so the NVAPI session work (which previously ran on the main/UI thread
/// and froze the window) is dispatched to the async runtime instead.
#[cfg(not(coverage))]
#[tauri::command]
pub async fn dlss_get_game_preset(
    state: tauri::State<'_, AppState>,
    game_id: i64,
    preset_kind: PresetKind,
) -> AppResult<GamePresetState> {
    Ok(nvapi::presets::get_game_preset_impl(
        &state,
        game_id,
        preset_kind,
    )?)
}

/// Write the per-game preset value (Phase 3 logic).
#[cfg(not(coverage))]
#[tauri::command]
pub async fn dlss_set_game_preset(
    state: tauri::State<'_, AppState>,
    game_id: i64,
    preset_kind: PresetKind,
    value: u32,
) -> AppResult<()> {
    Ok(nvapi::presets::set_game_preset_impl(
        &state,
        game_id,
        preset_kind,
        value,
    )?)
}

/// Apply all per-game DLSS changes (DLL versions + presets + folder override) in
/// one call. Combines [`swap`] (DLL versions) and [`nvapi::presets`] (presets),
/// then returns the refreshed cached state. Behavior lights up as Phases 2 & 3
/// implement the underlying module functions.
#[cfg(not(coverage))]
#[tauri::command]
pub async fn dlss_save_game(
    state: tauri::State<'_, AppState>,
    game_id: i64,
    changes: SaveGameDlss,
) -> AppResult<GameDlssState> {
    save_game_impl(&state, game_id, changes).await
}

/// Testable core for [`dlss_save_game`]: apply folder override, then DLL version
/// changes per type, then preset changes, and return the refreshed state.
pub async fn save_game_impl(
    state: &AppState,
    game_id: i64,
    changes: SaveGameDlss,
) -> AppResult<GameDlssState> {
    if let Some(folder) = changes.folder_override.as_deref() {
        set_folder_override_impl(state, game_id, Some(folder))?;
    }
    apply_version(
        state,
        game_id,
        DllType::SuperResolution,
        changes.sr.as_ref(),
    )
    .await?;
    apply_version(
        state,
        game_id,
        DllType::FrameGeneration,
        changes.fg.as_ref(),
    )
    .await?;
    apply_version(
        state,
        game_id,
        DllType::RayReconstruction,
        changes.rr.as_ref(),
    )
    .await?;
    if let Some(value) = changes.sr_preset {
        nvapi::presets::set_game_preset_impl(state, game_id, PresetKind::Dlss, value)?;
    }
    if let Some(value) = changes.rr_preset {
        nvapi::presets::set_game_preset_impl(state, game_id, PresetKind::RayReconstruction, value)?;
    }
    // Re-scan so the returned state (and the in-memory cache that drives the
    // library pills) reflects the just-saved folder override / DLL changes
    // immediately, without waiting for the next launch's startup scan.
    Ok(detect::scan_game_impl(state, game_id)?)
}

/// Apply a single optional DLL version change for one type during `save_game`.
async fn apply_version(
    state: &AppState,
    game_id: i64,
    dll_type: DllType,
    selection: Option<&SaveGameDllSelection>,
) -> AppResult<()> {
    if let Some(selection) = selection {
        let target = match selection {
            SaveGameDllSelection::Version { version } => SwapTarget::Version(version.clone()),
            SaveGameDllSelection::SystemDefault => SwapTarget::SystemDefault,
        };
        apply_to_game_impl(state, game_id, dll_type, target).await?;
    }
    Ok(())
}

/// Relaunch the app as Administrator (never returns on success). Phase 1
/// implements; on non-Windows / coverage it reports unsupported.
#[cfg(not(coverage))]
#[tauri::command]
pub fn dlss_relaunch_elevated() -> AppResult<()> {
    Ok(elevation::relaunch_as_admin()?)
}
