//! Streamed version downloads with progress + MD5 verify + unzip (Phase 2).
//!
//! Downloads a version's zip with the async `reqwest::Client` (`bytes_stream`)
//! to a temp file, emitting `dlss://download-progress` updates through a
//! [`ProgressSink`], verifies the zip MD5, extracts the target DLL into storage,
//! and cleans up temp. Cancellation is cooperative via a process-wide registry
//! keyed by type + version.

use std::collections::HashSet;
use std::io::Read;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use futures_util::StreamExt;
use md5::{Digest, Md5};

use crate::domain::{DllType, DownloadProgress};
use crate::dlss::{manifest, storage, DlssError, DlssResult};
use crate::state::AppState;

/// A sink for download-progress updates. The command layer implements this over
/// a Tauri `AppHandle`; tests use a recording fake.
pub trait ProgressSink: Send + Sync {
    /// Emit one progress update.
    fn emit(&self, progress: &DownloadProgress);
}

/// A [`ProgressSink`] that discards updates (used where progress is irrelevant).
pub struct NoopProgressSink;

impl ProgressSink for NoopProgressSink {
    fn emit(&self, _progress: &DownloadProgress) {}
}

/// Process-wide set of in-flight download keys requested for cancellation.
fn cancel_registry() -> &'static Mutex<HashSet<String>> {
    static REGISTRY: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashSet::new()))
}

/// The registry key for a type + version pair.
fn cancel_key(dll_type: DllType, version: &str) -> String {
    format!("{}:{version}", dll_type.storage_slug())
}

/// Whether a cancellation has been requested for this download (consumes it).
fn take_cancelled(dll_type: DllType, version: &str) -> bool {
    let key = cancel_key(dll_type, version);
    cancel_registry()
        .lock()
        .map(|mut set| set.remove(&key))
        .unwrap_or(false)
}

/// Drop any pending cancel request for this type + version without acting on it.
///
/// Called on entry to (and at every terminal path of) a fresh download so a stale
/// cancel request left over from an earlier, non-streaming download can't poison
/// an unrelated future download of the same `(type, version)`.
pub fn clear_cancelled(dll_type: DllType, version: &str) {
    let key = cancel_key(dll_type, version);
    if let Ok(mut set) = cancel_registry().lock() {
        set.remove(&key);
    }
}

/// Whether a cancel request is currently pending for this type + version (test
/// seam; does not consume the request).
pub fn is_cancel_pending(dll_type: DllType, version: &str) -> bool {
    let key = cancel_key(dll_type, version);
    cancel_registry()
        .lock()
        .map(|set| set.contains(&key))
        .unwrap_or(false)
}

/// Request cancellation of an in-flight download for the given type + version.
pub fn cancel_download_impl(_state: &AppState, dll_type: DllType, version: &str) -> DlssResult<()> {
    let key = cancel_key(dll_type, version);
    if let Ok(mut set) = cancel_registry().lock() {
        set.insert(key);
    }
    Ok(())
}

/// Download (if missing) the given version's DLL into local storage, emitting
/// progress through `sink`.
pub async fn download_version_impl(
    state: &AppState,
    dll_type: DllType,
    version: &str,
    sink: &dyn ProgressSink,
) -> DlssResult<()> {
    clear_cancelled(dll_type, version);
    let app_data_dir = state.app_data_dir().to_path_buf();
    let catalog = load_catalog(state).await?;
    let entry = manifest::find_by_version(&catalog, dll_type, version)
        .ok_or_else(|| DlssError::Invalid(format!("unknown version {version}")))?
        .clone();

    // Already present: nothing to do, report done.
    if storage::is_downloaded(&app_data_dir, dll_type, &entry.version, &entry.md5) {
        sink.emit(&done_progress(dll_type, version, entry.zip_size_bytes));
        clear_cancelled(dll_type, version);
        return Ok(());
    }

    let result = run_download(&app_data_dir, dll_type, &entry, sink).await;
    if let Err(err) = &result {
        sink.emit(&error_progress(dll_type, version, err.to_string()));
    }
    clear_cancelled(dll_type, version);
    result
}

/// Stream the zip to a temp file, verify the MD5, extract, and store.
async fn run_download(
    app_data_dir: &Path,
    dll_type: DllType,
    entry: &crate::domain::DllVersion,
    sink: &dyn ProgressSink,
) -> DlssResult<()> {
    clear_cancelled(dll_type, &entry.version);
    storage::ensure_temp_dir(app_data_dir)?;
    let temp_path = storage::temp_dir(app_data_dir)
        .join(format!("{}.zip", storage::version_key(&entry.version, &entry.md5)));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|err| DlssError::Network(format!("build download client: {err}")))?;
    let response = client
        .get(&entry.download_url)
        .send()
        .await
        .map_err(|err| DlssError::Network(err.to_string()))?
        .error_for_status()
        .map_err(|err| DlssError::Network(err.to_string()))?;

    let total = response.content_length().unwrap_or(entry.zip_size_bytes);
    let mut downloaded: u64 = 0;
    let mut hasher = Md5::new();
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();

    sink.emit(&progress(dll_type, &entry.version, 0, total, false));

    while let Some(chunk) = stream.next().await {
        if take_cancelled(dll_type, &entry.version) {
            cleanup_temp(&temp_path);
            return Err(DlssError::Invalid("download cancelled".to_string()));
        }
        let chunk = chunk.map_err(|err| DlssError::Network(err.to_string()))?;
        hasher.update(&chunk);
        bytes.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;
        sink.emit(&progress(dll_type, &entry.version, downloaded, total, false));
    }

    let digest = hasher.finalize();
    let actual = digest.iter().map(|b| format!("{b:02x}")).collect::<String>();

    std::fs::write(&temp_path, &bytes)?;
    let store_result = store_zip_bytes(app_data_dir, dll_type, entry, &bytes, &actual);
    cleanup_temp(&temp_path);
    store_result?;

    sink.emit(&done_progress(dll_type, &entry.version, total));
    Ok(())
}

/// Verify the zip MD5, extract the target DLL, verify its MD5, and write it into
/// local storage. Pure (no network): testable with an in-memory zip. `zip_md5`
/// is the precomputed lowercase MD5 of `zip_bytes`.
pub fn store_zip_bytes(
    app_data_dir: &Path,
    dll_type: DllType,
    entry: &crate::domain::DllVersion,
    zip_bytes: &[u8],
    zip_md5: &str,
) -> DlssResult<()> {
    if !entry.zip_md5.is_empty() && zip_md5 != entry.zip_md5 {
        return Err(DlssError::Invalid(format!(
            "download MD5 mismatch: expected {}, got {zip_md5}",
            entry.zip_md5
        )));
    }
    extract_dll(app_data_dir, dll_type, entry, zip_bytes)
}

/// Extract the target NGX DLL from the zip bytes into local storage, verifying
/// the extracted DLL's MD5 matches the catalog.
fn extract_dll(
    app_data_dir: &Path,
    dll_type: DllType,
    entry: &crate::domain::DllVersion,
    zip_bytes: &[u8],
) -> DlssResult<()> {
    let cursor = std::io::Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|err| DlssError::Invalid(format!("open zip: {err}")))?;
    let target_name = dll_type.dll_filename();

    let mut dll_bytes: Option<Vec<u8>> = None;
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|err| DlssError::Invalid(format!("read zip entry: {err}")))?;
        let matches = Path::new(file.name())
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.eq_ignore_ascii_case(target_name))
            .unwrap_or(false);
        if matches {
            let mut buf = Vec::new();
            file.read_to_end(&mut buf)?;
            dll_bytes = Some(buf);
            break;
        }
    }

    let dll_bytes = dll_bytes.ok_or_else(|| {
        DlssError::Invalid(format!("{target_name} not found in downloaded zip"))
    })?;

    if !entry.md5.is_empty() {
        let actual = super::detect::md5_hex(&dll_bytes);
        if actual != entry.md5 {
            return Err(DlssError::Invalid(format!(
                "extracted DLL MD5 mismatch: expected {}, got {actual}",
                entry.md5
            )));
        }
    }

    let dest = storage::local_dll_path(app_data_dir, dll_type, &entry.version, &entry.md5);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&dest, &dll_bytes)?;
    Ok(())
}

/// Best-effort temp-file removal (logged, never fatal).
fn cleanup_temp(path: &Path) {
    if path.exists() {
        if let Err(err) = std::fs::remove_file(path) {
            tracing::warn!(category = "dlss", "remove temp download {path:?} failed: {err}");
        }
    }
}

/// Load the catalog (cache → static) without forcing a remote refresh.
async fn load_catalog(state: &AppState) -> DlssResult<crate::domain::DllCatalog> {
    let app_data_dir = state.app_data_dir().to_path_buf();
    manifest::build_catalog(&app_data_dir, false).await
}

/// Build an in-progress event.
fn progress(
    dll_type: DllType,
    version: &str,
    downloaded: u64,
    total: u64,
    done: bool,
) -> DownloadProgress {
    DownloadProgress {
        dll_type,
        version: version.to_string(),
        downloaded_bytes: downloaded,
        total_bytes: total,
        done,
        error: None,
    }
}

/// Build a completion event.
fn done_progress(dll_type: DllType, version: &str, total: u64) -> DownloadProgress {
    progress(dll_type, version, total, total, true)
}

/// Build an error event.
fn error_progress(dll_type: DllType, version: &str, message: String) -> DownloadProgress {
    DownloadProgress {
        dll_type,
        version: version.to_string(),
        downloaded_bytes: 0,
        total_bytes: 0,
        done: true,
        error: Some(message),
    }
}
