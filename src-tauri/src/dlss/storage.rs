//! On-disk storage layout for the DLSS feature.
//!
//! Owns every DLSS path under the app-data root:
//! - downloaded DLLs (per type, keyed by version + hash),
//! - the cached manifest JSON,
//! - the temp-download scratch folder.
//!
//! All paths are derived from a caller-supplied app-data directory so the layout
//! is testable against a tempdir without touching the real Tauri data dir.

use std::path::{Path, PathBuf};

use crate::domain::DllType;
use crate::dlss::DlssResult;

/// Root subfolder name for all DLSS state under the app-data directory.
const DLSS_ROOT: &str = "dlss";
/// Subfolder holding downloaded DLLs (one folder per type).
const DLLS_DIR: &str = "dlls";
/// Subfolder for in-flight downloads.
const TEMP_DIR: &str = "temp";
/// Cached manifest filename.
const MANIFEST_FILE: &str = "manifest.json";

/// The DLSS root under `app_data_dir`.
pub fn root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(DLSS_ROOT)
}

/// The cached-manifest file path.
pub fn manifest_path(app_data_dir: &Path) -> PathBuf {
    root(app_data_dir).join(MANIFEST_FILE)
}

/// The temp-download scratch folder.
pub fn temp_dir(app_data_dir: &Path) -> PathBuf {
    root(app_data_dir).join(TEMP_DIR)
}

/// The per-type folder holding downloaded DLLs for `dll_type`.
pub fn dll_type_dir(app_data_dir: &Path, dll_type: DllType) -> PathBuf {
    root(app_data_dir).join(DLLS_DIR).join(dll_type.storage_slug())
}

/// Sanitize a version + hash into a filesystem-safe key (`<version>_<md5>`).
///
/// Versions can contain dots only; the MD5 disambiguates collisions. Any path
/// separators are stripped defensively.
pub fn version_key(version: &str, md5: &str) -> String {
    let clean = |value: &str| {
        value
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-')
            .collect::<String>()
    };
    format!("{}_{}", clean(version), clean(md5))
}

/// The expected local path of a downloaded DLL for `dll_type` / `version` / `md5`.
pub fn local_dll_path(
    app_data_dir: &Path,
    dll_type: DllType,
    version: &str,
    md5: &str,
) -> PathBuf {
    dll_type_dir(app_data_dir, dll_type)
        .join(version_key(version, md5))
        .join(dll_type.dll_filename())
}

/// Whether the DLL for `dll_type` / `version` / `md5` is present locally.
pub fn is_downloaded(app_data_dir: &Path, dll_type: DllType, version: &str, md5: &str) -> bool {
    local_dll_path(app_data_dir, dll_type, version, md5).is_file()
}

/// Ensure the per-type DLL directory exists, returning it.
pub fn ensure_dll_type_dir(app_data_dir: &Path, dll_type: DllType) -> DlssResult<PathBuf> {
    let dir = dll_type_dir(app_data_dir, dll_type);
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Ensure the temp-download directory exists, returning it.
pub fn ensure_temp_dir(app_data_dir: &Path) -> DlssResult<PathBuf> {
    let dir = temp_dir(app_data_dir);
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}
