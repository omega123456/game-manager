//! DLL detection: folder resolution + recursive NGX-DLL scan (Phase 2).
//!
//! Detection resolves a game's install folder (override → exe parent of the
//! `launch_target` when it is a filesystem path → none), recursively scans for
//! the three NGX DLLs, reads each DLL's identity through a [`FileVersionReader`]
//! seam (a real `windows`-API impl plus a fake for tests), matches the read MD5
//! to a catalog version, and persists the result to `game_dlss_state`.
//!
//! All non-FFI logic lives behind the [`FileVersionReader`] trait so detection
//! is fully testable against tempdir fixtures without real signed DLLs.

use std::path::{Path, PathBuf};

use crate::domain::{DetectedDll, DllType, GameDlssState};
use crate::dlss::{manifest, DlssError, DlssResult};
use crate::state::AppState;

/// The identity of a DLL file read from disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DllIdentity {
    /// Lowercase MD5 of the file's bytes (used to match the catalog).
    pub md5: String,
    /// The file-version string read from the binary (fallback display version).
    pub file_version: String,
}

/// Reads the identity (MD5 + file version) of a DLL on disk.
///
/// This is the testability seam: the real implementation hashes the file and
/// reads the Windows version resource, while tests inject a fake that returns
/// canned identities for fixture paths.
pub trait FileVersionReader: Send + Sync {
    /// Read the identity of the DLL at `path`.
    fn read(&self, path: &Path) -> DlssResult<DllIdentity>;
}

/// Compute the lowercase hex MD5 of a byte slice (shared by the real reader and
/// tests). Kept as a free function so the hashing path stays covered.
pub fn md5_hex(bytes: &[u8]) -> String {
    use md5::{Digest, Md5};
    let mut hasher = Md5::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// The real [`FileVersionReader`]: MD5 from file bytes + the Windows version
/// resource. Only constructed at runtime on Windows; the version-resource read
/// is a thin FFI wrapper.
pub struct RealFileVersionReader;

impl FileVersionReader for RealFileVersionReader {
    fn read(&self, path: &Path) -> DlssResult<DllIdentity> {
        let bytes = std::fs::read(path)?;
        let md5 = md5_hex(&bytes);
        let file_version = read_file_version(path).unwrap_or_default();
        Ok(DllIdentity { md5, file_version })
    }
}

/// Read the four-part file version (e.g. `3.7.10.0`) from a binary's version
/// resource. Returns `None` when the file has no version info.
#[cfg(all(windows, not(coverage)))]
fn read_file_version(path: &Path) -> Option<String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, VS_FIXEDFILEINFO,
    };

    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let pcwstr = PCWSTR(wide.as_ptr());
    unsafe {
        let size = GetFileVersionInfoSizeW(pcwstr, None);
        if size == 0 {
            return None;
        }
        let mut buffer = vec![0u8; size as usize];
        GetFileVersionInfoW(pcwstr, 0, size, buffer.as_mut_ptr() as *mut _).ok()?;
        let mut value_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut value_len: u32 = 0;
        let root: Vec<u16> = "\\\0".encode_utf16().collect();
        if !VerQueryValueW(
            buffer.as_ptr() as *const _,
            PCWSTR(root.as_ptr()),
            &mut value_ptr,
            &mut value_len,
        )
        .as_bool()
            || value_ptr.is_null()
        {
            return None;
        }
        let info = &*(value_ptr as *const VS_FIXEDFILEINFO);
        let major = (info.dwFileVersionMS >> 16) & 0xffff;
        let minor = info.dwFileVersionMS & 0xffff;
        let build = (info.dwFileVersionLS >> 16) & 0xffff;
        let revision = info.dwFileVersionLS & 0xffff;
        Some(format!("{major}.{minor}.{build}.{revision}"))
    }
}

/// Non-Windows / coverage fallback: no version resource available.
#[cfg(not(all(windows, not(coverage))))]
fn read_file_version(_path: &Path) -> Option<String> {
    None
}

/// Resolve a game's install folder: explicit override first, otherwise the
/// parent directory of the `launch_target` when it is an existing filesystem
/// path (exe/shortcut). Returns `None` when no folder can be resolved (e.g. a
/// URI launch target with no override).
pub fn resolve_folder(folder_override: Option<&str>, launch_target: &str) -> Option<PathBuf> {
    if let Some(folder) = folder_override.map(str::trim).filter(|s| !s.is_empty()) {
        let path = PathBuf::from(folder);
        if path.is_dir() {
            return Some(path);
        }
        return None;
    }
    let target = PathBuf::from(launch_target.trim());
    if target.is_file() {
        return target.parent().map(Path::to_path_buf);
    }
    if target.is_dir() {
        return Some(target);
    }
    None
}

/// Recursively find the on-disk path of `dll_type`'s NGX DLL beneath `root`.
///
/// Returns the first match found (depth-first). Symlinks are not followed.
pub fn find_dll(root: &Path, dll_type: DllType) -> Option<PathBuf> {
    let filename = dll_type.dll_filename();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.eq_ignore_ascii_case(filename))
                    .unwrap_or(false)
            {
                return Some(path);
            }
        }
    }
    None
}

/// Detect every NGX DLL beneath `folder`, matching MD5s against `catalog`.
///
/// For each type that is present, returns a [`DetectedDll`] whose `version` is
/// the catalog display version when the MD5 matches, otherwise the file-version
/// string read from the binary (trailing `.0` trimmed). The DLL's MD5 is always
/// carried so callers can re-match later.
pub fn detect_in_folder(
    folder: &Path,
    catalog: &crate::domain::DllCatalog,
    reader: &dyn FileVersionReader,
) -> DlssResult<DetectionSummary> {
    let mut summary = DetectionSummary::default();
    for dll_type in DllType::ALL {
        let Some(path) = find_dll(folder, dll_type) else {
            continue;
        };
        let identity = reader.read(&path)?;
        let version = match manifest::find_by_md5(catalog, dll_type, &identity.md5) {
            Some(found) => found.version.clone(),
            None => crate::dlss::display_version(&identity.file_version),
        };
        let detected = DetectedDll {
            version,
            path: path.to_string_lossy().to_string(),
            md5: Some(identity.md5),
        };
        match dll_type {
            DllType::SuperResolution => summary.super_resolution = Some(detected),
            DllType::FrameGeneration => summary.frame_generation = Some(detected),
            DllType::RayReconstruction => summary.ray_reconstruction = Some(detected),
        }
    }
    Ok(summary)
}

/// The per-type detection results for one folder scan.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DetectionSummary {
    /// Detected Super Resolution DLL, if any.
    pub super_resolution: Option<DetectedDll>,
    /// Detected Frame Generation DLL, if any.
    pub frame_generation: Option<DetectedDll>,
    /// Detected Ray Reconstruction DLL, if any.
    pub ray_reconstruction: Option<DetectedDll>,
}

/// Scan a single game with a caller-supplied reader and catalog, persisting the
/// result. The runtime entry points ([`scan_game_impl`]) wrap this with the real
/// reader and the resolved catalog; tests call it with a fake reader.
pub fn scan_game_with(
    state: &AppState,
    game_id: i64,
    catalog: &crate::domain::DllCatalog,
    reader: &dyn FileVersionReader,
) -> DlssResult<GameDlssState> {
    let game = state
        .with_db(|conn| crate::db::repo::games::get(conn, game_id))
        .map_err(DlssError::from)?;
    let cached = state
        .with_db(|conn| crate::db::repo::dlss::get(conn, game_id))
        .map_err(DlssError::from)?;
    let folder_override = cached.as_ref().and_then(|s| s.folder_override.clone());

    let folder = resolve_folder(folder_override.as_deref(), &game.launch_target);
    tracing::info!(
        category = "dlss",
        game_id,
        game_name = %game.name,
        launch_target = %game.launch_target,
        folder_override = ?folder_override,
        resolved_folder = ?folder.as_ref().map(|path| path.to_string_lossy().to_string()),
        "dlss dll scan: resolved install folder"
    );
    let summary = match folder.as_ref() {
        Some(dir) => detect_in_folder(dir, catalog, reader)?,
        None => DetectionSummary::default(),
    };
    tracing::info!(
        category = "dlss",
        game_id,
        detected_sr = ?summary
            .super_resolution
            .as_ref()
            .map(|dll| (&dll.version, dll.path.as_str())),
        detected_fg = ?summary
            .frame_generation
            .as_ref()
            .map(|dll| (&dll.version, dll.path.as_str())),
        detected_rr = ?summary
            .ray_reconstruction
            .as_ref()
            .map(|dll| (&dll.version, dll.path.as_str())),
        "dlss dll scan: detection result"
    );

    let now = chrono::Utc::now().to_rfc3339();
    let resolved = folder.as_ref().map(|f| f.to_string_lossy().to_string());
    let new_state = GameDlssState {
        game_id,
        folder_override,
        folder_resolved: resolved,
        super_resolution: summary.super_resolution,
        frame_generation: summary.frame_generation,
        ray_reconstruction: summary.ray_reconstruction,
        last_scanned_at: Some(now),
        stale: false,
    };
    state
        .with_db(|conn| crate::db::repo::dlss::upsert(conn, &new_state))
        .map_err(DlssError::from)?;
    Ok(new_state)
}

/// Re-scan a single game's folder and persist the detected versions.
pub fn scan_game_impl(state: &AppState, game_id: i64) -> DlssResult<GameDlssState> {
    tracing::info!(category = "dlss", game_id, "dlss_scan_game: starting folder scan");
    let catalog = load_catalog(state)?;
    let reader = RealFileVersionReader;
    scan_game_with(state, game_id, &catalog, &reader)
}

/// Re-scan every game and return the refreshed states.
pub fn scan_library_with(
    state: &AppState,
    catalog: &crate::domain::DllCatalog,
    reader: &dyn FileVersionReader,
) -> DlssResult<Vec<GameDlssState>> {
    let games = state
        .with_db(|conn| crate::db::repo::games::list(conn))
        .map_err(DlssError::from)?;
    let mut states = Vec::with_capacity(games.len());
    for game in games {
        match scan_game_with(state, game.id, catalog, reader) {
            Ok(state) => states.push(state),
            Err(err) => {
                tracing::warn!(category = "dlss", "scan of game {} failed: {err}", game.id);
            }
        }
    }
    Ok(states)
}

/// Re-scan every applicable game and return the refreshed states.
pub fn scan_library_impl(state: &AppState) -> DlssResult<Vec<GameDlssState>> {
    tracing::info!(category = "dlss", "dlss_scan_library: starting full library scan");
    let catalog = load_catalog(state)?;
    let reader = RealFileVersionReader;
    let states = scan_library_with(state, &catalog, &reader)?;
    tracing::info!(
        category = "dlss",
        games_scanned = states.len(),
        with_dll = states
            .iter()
            .filter(|state| {
                state.super_resolution.is_some()
                    || state.frame_generation.is_some()
                    || state.ray_reconstruction.is_some()
            })
            .count(),
        "dlss_scan_library: finished"
    );
    Ok(states)
}

/// Load the catalog (cache → static) for MD5 matching during a scan.
fn load_catalog(state: &AppState) -> DlssResult<crate::domain::DllCatalog> {
    let app_data_dir = state.app_data_dir().to_path_buf();
    match manifest::load_cache(&app_data_dir)? {
        Some(catalog) => Ok(catalog),
        None => manifest::load_static(),
    }
}
