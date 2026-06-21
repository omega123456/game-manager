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

use crate::dlss::{manifest, DlssError, DlssResult};
use crate::domain::{DetectedDll, DllType, GameDlssState};
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
    use std::fmt::Write as _;
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        // write! into a String is infallible.
        write!(out, "{byte:02x}").unwrap();
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

/// Recursively find the on-disk paths of all three NGX DLLs beneath `root` in a
/// **single** traversal.
///
/// Returns an array indexed positionally by [`DllType::ALL`] (SR, FG, RR); each
/// slot holds the first match found for that type (depth-first). Symlinks are
/// not followed and filename matching is case-insensitive. The walk short-
/// circuits once all three types are found.
pub fn find_all_dlls(root: &Path) -> [Option<PathBuf>; 3] {
    let mut found: [Option<PathBuf>; 3] = [None, None, None];
    let mut remaining = DllType::ALL.len();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if remaining == 0 {
            break;
        }
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
            } else if file_type.is_file() {
                let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                    continue;
                };
                for (idx, dll_type) in DllType::ALL.into_iter().enumerate() {
                    if found[idx].is_none() && name.eq_ignore_ascii_case(dll_type.dll_filename()) {
                        found[idx] = Some(path.clone());
                        remaining -= 1;
                        break;
                    }
                }
            }
        }
    }
    found
}

/// Recursively find the on-disk path of `dll_type`'s NGX DLL beneath `root`.
///
/// Returns the first match found (depth-first). Symlinks are not followed.
/// Thin wrapper over [`find_all_dlls`] for single-type callers.
pub fn find_dll(root: &Path, dll_type: DllType) -> Option<PathBuf> {
    let idx = DllType::ALL
        .into_iter()
        .position(|t| t == dll_type)
        .expect("DllType::ALL covers every variant");
    find_all_dlls(root)
        .into_iter()
        .nth(idx)
        .expect("idx is a valid index into the fixed-size find_all_dlls result")
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
    let found = find_all_dlls(folder);
    for (idx, dll_type) in DllType::ALL.into_iter().enumerate() {
        let Some(path) = found[idx].as_ref() else {
            continue;
        };
        let identity = reader.read(path)?;
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

/// A session-only detection result for one game, held in [`AppState`]'s
/// in-memory cache. DLSS detection is **never persisted** — it is recomputed on
/// every app launch and lives only for the lifetime of the process.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DetectionResult {
    /// The install folder the scan resolved/used, if any.
    pub folder_resolved: Option<String>,
    /// The per-type detected DLLs from the scan.
    pub summary: DetectionSummary,
    /// Timestamp of the scan (RFC 3339).
    pub last_scanned_at: Option<String>,
    /// Per-game DLSS SR preset (NVAPI) read at scan time, when available.
    /// `None` when SR is undetected, NVAPI is absent, or no profile matches.
    pub sr_preset: Option<u32>,
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

/// Assemble the IPC-facing [`GameDlssState`] for a game from its durable
/// folder override and its session-only detection.
///
/// When `detection` is `None` the game has not been scanned this session yet, so
/// the result is marked `stale` (the frontend treats this as "needs scan").
pub fn build_game_state(
    game_id: i64,
    folder_override: Option<String>,
    detection: Option<DetectionResult>,
) -> GameDlssState {
    match detection {
        Some(det) => GameDlssState {
            game_id,
            folder_override,
            folder_resolved: det.folder_resolved,
            super_resolution: det.summary.super_resolution,
            frame_generation: det.summary.frame_generation,
            ray_reconstruction: det.summary.ray_reconstruction,
            last_scanned_at: det.last_scanned_at,
            sr_preset: det.sr_preset,
            stale: false,
        },
        None => GameDlssState {
            game_id,
            folder_override,
            stale: true,
            ..GameDlssState::default()
        },
    }
}

/// The DB-free, NVAPI-free product of the per-game detection core: the resolved
/// install folder (as a display string, if any) plus the per-type detection
/// summary. The stateful orchestration tail ([`finish_game_scan`]) turns this
/// into a cached [`DetectionResult`] + IPC [`GameDlssState`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CoreDetection {
    /// The install folder the scan resolved/used, if any.
    pub folder_resolved: Option<String>,
    /// The per-type detected DLLs from the single-pass walk.
    pub summary: DetectionSummary,
}

/// Pure per-game detection: resolve the install folder from the already-loaded
/// override + launch target, run the single-pass walk, read identities, and
/// match the catalog — with **no** [`AppState`] access and **no** NVAPI.
///
/// This is the parallel-safe, fake-reader-testable unit. It borrows only the
/// catalog and reader (both `Send + Sync`) plus owned per-game inputs, so it can
/// run on a worker thread with no DB lock contention. The stateful tail
/// (NVAPI SR-preset read, cache write, `GameDlssState` assembly) lives in
/// [`finish_game_scan`].
pub fn detect_game_core(
    game_id: i64,
    game_name: &str,
    launch_target: &str,
    folder_override: Option<&str>,
    catalog: &crate::domain::DllCatalog,
    reader: &dyn FileVersionReader,
) -> DlssResult<CoreDetection> {
    let folder = resolve_folder(folder_override, launch_target);
    tracing::debug!(
        category = "dlss",
        game_id,
        game_name,
        launch_target,
        folder_override = ?folder_override,
        resolved_folder = ?folder.as_ref().map(|path| path.to_string_lossy().to_string()),
        "dlss dll scan: resolved install folder"
    );
    let summary = match folder.as_ref() {
        Some(dir) => detect_in_folder(dir, catalog, reader)?,
        None => DetectionSummary::default(),
    };
    tracing::debug!(
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
    Ok(CoreDetection {
        folder_resolved: folder.as_ref().map(|f| f.to_string_lossy().to_string()),
        summary,
    })
}

/// Stateful orchestration tail wrapping [`detect_game_core`]'s pure result: read
/// the per-game SR preset via NVAPI (only when SR is present), write the
/// session-only detection into [`AppState`]'s in-memory cache, and assemble the
/// IPC [`GameDlssState`].
///
/// This is the side-effecting half; it must run on a serialized path (NVAPI is
/// not thread-safe). Under `test-utils` the NVAPI read collapses to `None`.
pub fn finish_game_scan(
    state: &AppState,
    game_id: i64,
    folder_override: Option<String>,
    core: CoreDetection,
) -> GameDlssState {
    let CoreDetection {
        folder_resolved,
        summary,
    } = core;

    // Read the per-game SR preset (NVAPI) only when an SR DLL is present; the
    // preset is meaningless without it. Any NVAPI failure collapses to `None`,
    // so this stays safe on the background scan thread and under `test-utils`.
    let sr_preset = if summary.super_resolution.is_some() {
        crate::dlss::nvapi::presets::read_game_sr_preset(state, game_id)
    } else {
        None
    };

    let now = chrono::Utc::now().to_rfc3339();
    // Detection is session-only: cache it in memory, never in the DB.
    state.dlss_detection_set(
        game_id,
        DetectionResult {
            folder_resolved: folder_resolved.clone(),
            summary: summary.clone(),
            last_scanned_at: Some(now.clone()),
            sr_preset,
        },
    );
    GameDlssState {
        game_id,
        folder_override,
        folder_resolved,
        super_resolution: summary.super_resolution,
        frame_generation: summary.frame_generation,
        ray_reconstruction: summary.ray_reconstruction,
        last_scanned_at: Some(now),
        sr_preset,
        stale: false,
    }
}

/// Scan a single game with a caller-supplied reader and catalog, caching the
/// result in memory. The runtime entry points ([`scan_game_impl`]) wrap this with
/// the real reader and the resolved catalog; tests call it with a fake reader.
///
/// Loads the one game + its folder override from the DB, then delegates to the
/// shared pure core ([`detect_game_core`]) + orchestration ([`finish_game_scan`]).
pub fn scan_game_with(
    state: &AppState,
    game_id: i64,
    catalog: &crate::domain::DllCatalog,
    reader: &dyn FileVersionReader,
) -> DlssResult<GameDlssState> {
    let game = state
        .with_db(|conn| crate::db::repo::games::get(conn, game_id))
        .map_err(DlssError::from)?;
    let folder_override = state
        .with_db(|conn| crate::db::repo::dlss::get_folder_override(conn, game_id))
        .map_err(DlssError::from)?;

    let core = detect_game_core(
        game_id,
        &game.name,
        &game.launch_target,
        folder_override.as_deref(),
        catalog,
        reader,
    )?;
    Ok(finish_game_scan(state, game_id, folder_override, core))
}

/// Re-scan a single game's folder and persist the detected versions.
pub fn scan_game_impl(state: &AppState, game_id: i64) -> DlssResult<GameDlssState> {
    tracing::debug!(
        category = "dlss",
        game_id,
        "dlss_scan_game: starting folder scan"
    );
    let catalog = load_catalog(state)?;
    let reader = RealFileVersionReader;
    scan_game_with(state, game_id, &catalog, &reader)
}

/// Receives per-game progress as a library scan proceeds, so callers can stream
/// each game's freshly scanned state (and a `scanned`/`total` count) to the UI
/// instead of waiting for the whole library to finish.
///
/// This is a testability + decoupling seam: the runtime path emits a Tauri event
/// per game, while tests inject a fake that records the calls.
pub trait ScanProgressSink: Send + Sync {
    /// Called once per game after it is scanned. `scanned` is 1-based and
    /// includes this game; `total` is the full library size.
    fn on_game(&self, scanned: u32, total: u32, state: &GameDlssState);
}

/// A [`ScanProgressSink`] that drops every update — used by callers (and tests)
/// that do not need streamed progress.
pub struct NoopScanProgress;

impl ScanProgressSink for NoopScanProgress {
    fn on_game(&self, _scanned: u32, _total: u32, _state: &GameDlssState) {}
}

/// Re-scan every game and return the refreshed states.
pub fn scan_library_with(
    state: &AppState,
    catalog: &crate::domain::DllCatalog,
    reader: &dyn FileVersionReader,
) -> DlssResult<Vec<GameDlssState>> {
    scan_library_with_progress(state, catalog, reader, &NoopScanProgress)
}

/// Re-scan every game, reporting each completed game to `progress`, and return
/// the refreshed states. The per-game `scanned` counter advances for every game
/// processed (so it reaches `total` even when some scans fail); `progress` is
/// only notified for games that scanned successfully (the only ones with state).
pub fn scan_library_with_progress(
    state: &AppState,
    catalog: &crate::domain::DllCatalog,
    reader: &dyn FileVersionReader,
    progress: &dyn ScanProgressSink,
) -> DlssResult<Vec<GameDlssState>> {
    let games = state
        .with_db(crate::db::repo::games::list)
        .map_err(DlssError::from)?;
    // Bulk-load every folder override once (8c): this replaces the per-game
    // `games::get` + `get_folder_override` lock acquisitions that the loop used
    // to do, leaving the per-game work entirely DB-free (the precondition for
    // 8b's parallel producer region).
    let overrides: std::collections::HashMap<i64, String> = state
        .with_db(crate::db::repo::dlss::list_folder_overrides)
        .map_err(DlssError::from)?
        .into_iter()
        .collect();
    // Drop cached detections for games that no longer exist so deleted games stop
    // counting toward the applicable totals (the cache is the source of truth).
    let live_ids: std::collections::HashSet<i64> = games.iter().map(|game| game.id).collect();
    state.dlss_detection_retain(&live_ids);
    let total = games.len() as u32;

    // 8b: parallelize the DB-free, I/O-bound per-game core across a bounded pool
    // of scoped producer threads, draining results into a single serialized
    // consumer that runs the stateful tail (NVAPI + cache write + progress emit).
    //
    // Producers borrow only `&catalog`/`&reader` (both `Send + Sync`) and the
    // pre-loaded `games`/`overrides` (shared-immutable); they pull the next game
    // index from a shared atomic cursor and emit their pure-core result over a
    // channel. They never touch `&AppState` or the DB. The consumer (this thread)
    // owns `&AppState` and runs every stateful side effect serially, so no NVAPI
    // mutex and no atomic progress counter are needed.
    if games.is_empty() {
        return Ok(Vec::new());
    }

    /// The result of one game's pure core, tagged with its source index so the
    /// consumer can store states in deterministic (pre-parallel) order.
    struct CoreResult {
        source_index: usize,
        game_id: i64,
        folder_override: Option<String>,
        core: CoreDetection,
    }

    let cursor = std::sync::atomic::AtomicUsize::new(0);
    let (tx, rx) = std::sync::mpsc::channel::<CoreResult>();

    let worker_count = std::thread::available_parallelism()
        .map(std::num::NonZeroUsize::get)
        .unwrap_or(1)
        .min(8)
        .min(games.len());

    // Slots store each game's final state at its source index for deterministic
    // ordering even though producers complete out of order (KD-9).
    let mut slots: Vec<Option<GameDlssState>> = (0..games.len()).map(|_| None).collect();
    let mut scanned: u32 = 0;

    std::thread::scope(|scope| {
        // Spawn the bounded producer pool. Each producer loops: claim the next
        // index via the atomic cursor, run the pure core, and emit the result.
        for _ in 0..worker_count {
            let tx = tx.clone();
            let cursor = &cursor;
            let games = &games;
            let overrides = &overrides;
            scope.spawn(move || loop {
                let idx = cursor.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let Some(game) = games.get(idx) else {
                    break;
                };
                let folder_override = overrides.get(&game.id).cloned();
                // Pure, DB-free per-game core (8a single-pass walk inside).
                match detect_game_core(
                    game.id,
                    &game.name,
                    &game.launch_target,
                    folder_override.as_deref(),
                    catalog,
                    reader,
                ) {
                    Ok(core) => {
                        // A closed receiver only happens if the consumer panicked;
                        // stop the worker rather than spinning.
                        if tx
                            .send(CoreResult {
                                source_index: idx,
                                game_id: game.id,
                                folder_override,
                                core,
                            })
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(err) => {
                        tracing::warn!(category = "dlss", "scan of game {} failed: {err}", game.id);
                    }
                }
            });
        }
        // Drop the original sender so the channel closes once all producers finish.
        drop(tx);

        // Single serialized consumer: drains results as producers emit them and
        // runs each game's stateful tail (NVAPI read + cache write + assembly +
        // progress emit) on this one thread. `scanned` is a plain monotonic count.
        for CoreResult {
            source_index,
            game_id,
            folder_override,
            core,
        } in rx
        {
            let game_state = finish_game_scan(state, game_id, folder_override, core);
            scanned += 1;
            progress.on_game(scanned, total, &game_state);
            slots[source_index] = Some(game_state);
        }
    });

    // Collect successfully-scanned states in deterministic source order; games
    // whose pure core failed leave a `None` slot and are skipped (matching the
    // sequential path's `continue`-on-error behavior).
    let states = slots.into_iter().flatten().collect();
    Ok(states)
}

/// Re-scan every applicable game and return the refreshed states.
pub fn scan_library_impl(state: &AppState) -> DlssResult<Vec<GameDlssState>> {
    scan_library_impl_with_progress(state, &NoopScanProgress)
}

/// Re-scan every applicable game, streaming per-game progress to `progress`, and
/// return the refreshed states. The runtime startup path passes a Tauri-backed
/// sink so library pills can render as each game completes.
pub fn scan_library_impl_with_progress(
    state: &AppState,
    progress: &dyn ScanProgressSink,
) -> DlssResult<Vec<GameDlssState>> {
    tracing::debug!(
        category = "dlss",
        "dlss_scan_library: starting full library scan"
    );
    let catalog = load_catalog(state)?;
    let reader = RealFileVersionReader;
    let states = scan_library_with_progress(state, &catalog, &reader, progress)?;
    tracing::debug!(
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
    if let Some((mut catalog, _refresh_attempted)) = state.dlss_catalog_get() {
        manifest::apply_downloaded_flags(state.app_data_dir(), &mut catalog);
        return Ok(catalog);
    }

    let catalog = match manifest::load_cache(state.app_data_dir())? {
        Some(catalog) => catalog,
        None => manifest::load_static()?,
    };
    state.dlss_catalog_set(catalog.clone(), false);
    Ok(catalog)
}
