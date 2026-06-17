//! DLL swap engine: backup, copy-over, reset, single + batch apply (Phase 2).
//!
//! Applies a chosen catalog version (or restores the original) to a game's NGX
//! DLL: on the first swap the original is backed up once to `<dll>.dlsss`, then
//! the chosen DLL is copied over it; "System Default" restores the backup.
//! Single-game apply re-scans afterward; "Apply to All" runs resiliently across
//! every applicable game and returns a per-game [`BatchApplyResult`]. ACL-denied
//! writes map to [`DlssError::Privilege`] so the UI can offer a relaunch.

use std::path::{Path, PathBuf};

use crate::domain::{ApplyResult, BatchApplyResult, DetectedDll, DllType, GameDlssState};
use crate::dlss::download::NoopProgressSink;
use crate::dlss::{detect, download, manifest, storage, DlssError, DlssResult};
use crate::state::AppState;

/// Backup extension appended to the original DLL before the first swap.
const BACKUP_EXT: &str = "dlsss";

/// The target of a swap: a specific catalog version, or the original backup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SwapTarget {
    /// Apply a specific display version.
    Version(String),
    /// Restore the original DLL from its `.dlsss` backup.
    SystemDefault,
}

/// A sink for per-game batch-apply progress. The command layer implements this
/// over a Tauri `AppHandle` (`dlss://apply-progress`); tests use a fake.
pub trait ApplyProgressSink: Send + Sync {
    /// Emit one per-game apply result as the batch progresses.
    fn emit(&self, result: &ApplyResult);
}

/// A no-op apply-progress sink.
pub struct NoopApplyProgressSink;

impl ApplyProgressSink for NoopApplyProgressSink {
    fn emit(&self, _result: &ApplyResult) {}
}

/// Map a filesystem error to a privilege error when access is denied, otherwise
/// to a generic IO error.
fn map_io(err: std::io::Error, context: &str) -> DlssError {
    if err.kind() == std::io::ErrorKind::PermissionDenied {
        tracing::warn!(category = "dlss", "privilege denied during {context}: {err}");
        DlssError::Privilege
    } else {
        DlssError::Io(format!("{context}: {err}"))
    }
}

/// The `.dlsss` backup path for a DLL.
fn backup_path(dll_path: &Path) -> PathBuf {
    let mut os = dll_path.as_os_str().to_os_string();
    os.push(".");
    os.push(BACKUP_EXT);
    PathBuf::from(os)
}

/// Resolve the on-disk destination path for `dll_type` in a game, using the
/// cached detected path if present, otherwise the resolved folder + filename.
fn destination_path(
    state: &AppState,
    game_id: i64,
    dll_type: DllType,
) -> DlssResult<Option<PathBuf>> {
    if let Some(detected) = state
        .dlss_detection_get(game_id)
        .and_then(|d| pick(&d.summary, dll_type).clone())
    {
        return Ok(Some(PathBuf::from(detected.path)));
    }
    // Fall back to the resolved folder + the canonical filename.
    let game = state
        .with_db(|conn| crate::db::repo::games::get(conn, game_id))
        .map_err(DlssError::from)?;
    let folder_override = state
        .with_db(|conn| crate::db::repo::dlss::get_folder_override(conn, game_id))
        .map_err(DlssError::from)?;
    let folder = detect::resolve_folder(folder_override.as_deref(), &game.launch_target);
    match folder {
        Some(dir) => {
            let candidate = detect::find_dll(&dir, dll_type)
                .unwrap_or_else(|| dir.join(dll_type.dll_filename()));
            Ok(Some(candidate))
        }
        None => Ok(None),
    }
}

/// Borrow the detected DLL for `dll_type` from a session detection summary.
fn pick(summary: &detect::DetectionSummary, dll_type: DllType) -> &Option<DetectedDll> {
    match dll_type {
        DllType::SuperResolution => &summary.super_resolution,
        DllType::FrameGeneration => &summary.frame_generation,
        DllType::RayReconstruction => &summary.ray_reconstruction,
    }
}

/// Ensure the chosen version's DLL is present locally, downloading if needed.
/// Returns the local source path to copy from.
async fn ensure_local(
    state: &AppState,
    dll_type: DllType,
    version: &str,
) -> DlssResult<PathBuf> {
    let app_data_dir = state.app_data_dir().to_path_buf();
    let catalog = manifest::build_catalog(&app_data_dir, false).await?;
    let entry = manifest::find_by_version(&catalog, dll_type, version)
        .ok_or_else(|| DlssError::Invalid(format!("unknown version {version}")))?
        .clone();
    let local = storage::local_dll_path(&app_data_dir, dll_type, &entry.version, &entry.md5);
    if !local.is_file() {
        let sink = NoopProgressSink;
        download::download_version_impl(state, dll_type, version, &sink).await?;
    }
    Ok(local)
}

/// Back up the original DLL once (if a backup does not already exist).
fn backup_once(dll_path: &Path) -> DlssResult<()> {
    let backup = backup_path(dll_path);
    if backup.exists() || !dll_path.exists() {
        return Ok(());
    }
    std::fs::copy(dll_path, &backup).map_err(|err| map_io(err, "back up DLL"))?;
    Ok(())
}

/// Copy `source` over `dest`, creating the destination's parent if needed.
fn copy_over(source: &Path, dest: &Path) -> DlssResult<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|err| map_io(err, "create folder"))?;
    }
    std::fs::copy(source, dest).map_err(|err| map_io(err, "write DLL"))?;
    Ok(())
}

/// Restore the original DLL from its `.dlsss` backup (System Default).
fn reset_from_backup(dll_path: &Path) -> DlssResult<()> {
    let backup = backup_path(dll_path);
    if !backup.exists() {
        // Nothing to restore; treat as already at System Default.
        return Ok(());
    }
    std::fs::copy(&backup, dll_path).map_err(|err| map_io(err, "restore DLL"))?;
    std::fs::remove_file(&backup).map_err(|err| map_io(err, "remove backup"))?;
    Ok(())
}

/// Apply a swap to a single game and return its refreshed state.
pub async fn apply_to_game_impl(
    state: &AppState,
    game_id: i64,
    dll_type: DllType,
    target: SwapTarget,
) -> DlssResult<GameDlssState> {
    let dest = destination_path(state, game_id, dll_type)?.ok_or_else(|| {
        DlssError::Invalid("could not resolve the game's install folder".to_string())
    })?;

    match &target {
        SwapTarget::Version(version) => {
            let source = ensure_local(state, dll_type, version).await?;
            backup_once(&dest)?;
            copy_over(&source, &dest)?;
        }
        SwapTarget::SystemDefault => {
            reset_from_backup(&dest)?;
        }
    }

    // Re-scan to reflect the change in the cache.
    let app_data_dir = state.app_data_dir().to_path_buf();
    let catalog = manifest::build_catalog(&app_data_dir, false).await?;
    let reader = detect::RealFileVersionReader;
    detect::scan_game_with(state, game_id, &catalog, &reader)
}

/// Apply a version to every applicable game, resiliently.
pub async fn apply_to_all_impl(
    state: &AppState,
    dll_type: DllType,
    version: &str,
    sink: &dyn ApplyProgressSink,
) -> DlssResult<BatchApplyResult> {
    let applicable: Vec<i64> = state
        .dlss_detection_snapshot()
        .into_iter()
        .filter(|(_, detection)| pick(&detection.summary, dll_type).is_some())
        .map(|(game_id, _)| game_id)
        .collect();

    let mut batch = BatchApplyResult {
        total: applicable.len() as u32,
        ..BatchApplyResult::default()
    };

    for game_id in applicable {
        let name = state
            .with_db(|conn| crate::db::repo::games::get(conn, game_id))
            .map(|game| game.name)
            .unwrap_or_else(|_| format!("game {game_id}"));
        let outcome =
            apply_to_game_impl(state, game_id, dll_type, SwapTarget::Version(version.to_string()))
                .await;
        let result = match outcome {
            Ok(_) => {
                batch.succeeded += 1;
                ApplyResult { game_id, name, ok: true, message: None }
            }
            Err(err) => {
                batch.failed += 1;
                tracing::warn!(category = "dlss", "apply to game {game_id} failed: {err}");
                ApplyResult {
                    game_id,
                    name,
                    ok: false,
                    message: Some(err.to_string()),
                }
            }
        };
        sink.emit(&result);
        batch.results.push(result);
    }

    Ok(batch)
}

/// Count games where `dll_type` is currently detected (drives the button label
/// + confirm). A cheap cache read, implemented in Phase 1.
pub fn count_applicable_impl(state: &AppState, dll_type: DllType) -> DlssResult<u32> {
    let count = state
        .dlss_detection_snapshot()
        .iter()
        .filter(|(_, detection)| pick(&detection.summary, dll_type).is_some())
        .count() as u32;
    Ok(count)
}
