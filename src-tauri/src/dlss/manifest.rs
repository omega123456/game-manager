//! DLSS version catalog: fetch, parse, cache, and static fallback.
//!
//! The remote catalog manifest is fetched with the async `reqwest::Client`, cached
//! to app-data, and falls back to the bundled static manifest when offline. Only
//! the three managed DLL types (SR / FG / RR) are surfaced; FSR/XeSS and other
//! keys are ignored. Versions are returned newest-first with a display label and
//! per-version `is_downloaded` flag.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Deserialize;

use crate::domain::{CatalogSource, DllCatalog, DllType, DllVersion};
use crate::dlss::{display_version, storage, DlssError, DlssResult};

/// The public upstream manifest URL.
pub const MANIFEST_URL: &str = "https://beeradmoore.github.io/dlss-swapper/manifest.json";

/// The bundled static fallback manifest, compiled into the binary.
const STATIC_MANIFEST: &str = include_str!("../../assets/dlss_static_manifest.json");

/// The raw upstream manifest shape (only the keys we consume).
#[derive(Debug, Deserialize)]
struct RawManifest {
    #[serde(default)]
    dlss: Vec<RawRecord>,
    #[serde(default)]
    dlss_g: Vec<RawRecord>,
    #[serde(default)]
    dlss_d: Vec<RawRecord>,
}

/// A single catalog DLL record from the upstream manifest.
#[derive(Debug, Deserialize)]
struct RawRecord {
    version: String,
    #[serde(default)]
    version_number: u64,
    #[serde(default)]
    additional_label: Option<String>,
    #[serde(default)]
    md5_hash: String,
    #[serde(default)]
    zip_md5_hash: String,
    #[serde(default)]
    download_url: String,
    #[serde(default)]
    file_size: u64,
    #[serde(default)]
    zip_file_size: u64,
    #[serde(default)]
    is_signature_valid: bool,
}

/// Fetch the upstream manifest, parse it, and write it to the on-disk cache.
///
/// Returns the parsed [`DllCatalog`] tagged [`CatalogSource::Remote`]. The
/// caller layers `is_downloaded` flags on top (see [`build_catalog`]).
pub async fn fetch_remote(app_data_dir: &Path) -> DlssResult<DllCatalog> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|err| DlssError::Network(format!("build manifest client: {err}")))?;
    let body = client
        .get(MANIFEST_URL)
        .send()
        .await
        .map_err(|err| DlssError::Network(err.to_string()))?
        .error_for_status()
        .map_err(|err| DlssError::Network(err.to_string()))?
        .text()
        .await
        .map_err(|err| DlssError::Network(err.to_string()))?;

    // Persist the raw body to the cache before parsing so a later parse change
    // can still re-read the original bytes.
    write_cache(app_data_dir, &body)?;

    let fetched_at = chrono::Utc::now().to_rfc3339();
    parse(&body, CatalogSource::Remote, Some(fetched_at))
}

/// Load the on-disk cached manifest, if present and parseable.
pub fn load_cache(app_data_dir: &Path) -> DlssResult<Option<DllCatalog>> {
    let path = storage::manifest_path(app_data_dir);
    if !path.is_file() {
        return Ok(None);
    }
    let body = std::fs::read_to_string(&path)?;
    let catalog = parse(&body, CatalogSource::Cache, None)?;
    Ok(Some(catalog))
}

/// Load the bundled static fallback catalog.
pub fn load_static() -> DlssResult<DllCatalog> {
    parse(STATIC_MANIFEST, CatalogSource::Static, None)
}

/// Write the raw manifest body to the on-disk cache.
fn write_cache(app_data_dir: &Path, body: &str) -> DlssResult<()> {
    let path = storage::manifest_path(app_data_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, body)?;
    Ok(())
}

/// Parse a raw manifest body into a [`DllCatalog`] (newest-first per type).
pub fn parse(
    body: &str,
    source: CatalogSource,
    fetched_at: Option<String>,
) -> DlssResult<DllCatalog> {
    let raw: RawManifest = serde_json::from_str(body)
        .map_err(|err| DlssError::Invalid(format!("parse manifest: {err}")))?;
    Ok(DllCatalog {
        super_resolution: convert(raw.dlss, DllType::SuperResolution),
        frame_generation: convert(raw.dlss_g, DllType::FrameGeneration),
        ray_reconstruction: convert(raw.dlss_d, DllType::RayReconstruction),
        source,
        fetched_at,
    })
}

/// Convert raw records into sorted (newest-first) [`DllVersion`]s.
fn convert(records: Vec<RawRecord>, dll_type: DllType) -> Vec<DllVersion> {
    let mut versions: Vec<DllVersion> = records
        .into_iter()
        .map(|record| to_version(record, dll_type))
        .collect();
    versions.sort_by(|a, b| b.version_number.cmp(&a.version_number));
    // Tag the newest as "Latest" when no explicit additional label already
    // distinguishes it.
    if let Some(first) = versions.first_mut() {
        if !first.label.contains('(') {
            first.label = format!("{} (Latest)", first.label);
        }
    }
    versions
}

/// Map a raw record into the domain version (display version + label).
fn to_version(record: RawRecord, dll_type: DllType) -> DllVersion {
    let version = display_version(&record.version);
    let label = match record.additional_label.as_deref() {
        Some(extra) if !extra.trim().is_empty() => format!("v{version} ({})", extra.trim()),
        _ => format!("v{version}"),
    };
    DllVersion {
        dll_type,
        version,
        version_number: record.version_number,
        label,
        md5: record.md5_hash.to_lowercase(),
        zip_md5: record.zip_md5_hash.to_lowercase(),
        download_url: record.download_url,
        file_size_bytes: record.file_size,
        zip_size_bytes: record.zip_file_size,
        is_signature_valid: record.is_signature_valid,
        is_downloaded: false,
    }
}

/// Resolve a catalog by preference: remote → cache → static.
///
/// When `refresh` is false the cache is preferred (and only the static fallback
/// is used when no cache exists). When `refresh` is true a remote fetch is
/// attempted first, falling back to cache then static on failure. The returned
/// catalog has `is_downloaded` flags applied from local storage.
pub async fn build_catalog(app_data_dir: &Path, refresh: bool) -> DlssResult<DllCatalog> {
    tracing::info!(
        category = "dlss",
        refresh,
        "dlss_get_catalog: resolving version catalog"
    );
    let mut catalog = if refresh {
        match fetch_remote(app_data_dir).await {
            Ok(catalog) => catalog,
            Err(err) => {
                tracing::warn!(category = "dlss", "manifest refresh failed: {err}; falling back");
                load_cache(app_data_dir)?.unwrap_or(load_static()?)
            }
        }
    } else {
        match load_cache(app_data_dir)? {
            Some(catalog) => catalog,
            None => load_static()?,
        }
    };
    apply_downloaded_flags(app_data_dir, &mut catalog);
    tracing::info!(
        category = "dlss",
        source = ?catalog.source,
        sr_versions = catalog.super_resolution.len(),
        fg_versions = catalog.frame_generation.len(),
        rr_versions = catalog.ray_reconstruction.len(),
        "dlss_get_catalog: catalog ready"
    );
    Ok(catalog)
}

/// Mark each version `is_downloaded` based on local storage presence.
pub fn apply_downloaded_flags(app_data_dir: &Path, catalog: &mut DllCatalog) {
    for version in catalog
        .super_resolution
        .iter_mut()
        .chain(catalog.frame_generation.iter_mut())
        .chain(catalog.ray_reconstruction.iter_mut())
    {
        version.is_downloaded =
            storage::is_downloaded(app_data_dir, version.dll_type, &version.version, &version.md5);
    }
}

/// Build a lookup of `md5 → DllVersion` across all types for detection matching.
pub fn md5_index(catalog: &DllCatalog) -> BTreeMap<String, DllVersion> {
    let mut index = BTreeMap::new();
    for version in catalog
        .super_resolution
        .iter()
        .chain(catalog.frame_generation.iter())
        .chain(catalog.ray_reconstruction.iter())
    {
        index.insert(version.md5.clone(), version.clone());
    }
    index
}

/// Find a catalog version matching `md5` for the given `dll_type`.
pub fn find_by_md5<'a>(
    catalog: &'a DllCatalog,
    dll_type: DllType,
    md5: &str,
) -> Option<&'a DllVersion> {
    let md5 = md5.to_lowercase();
    let list = match dll_type {
        DllType::SuperResolution => &catalog.super_resolution,
        DllType::FrameGeneration => &catalog.frame_generation,
        DllType::RayReconstruction => &catalog.ray_reconstruction,
    };
    list.iter().find(|version| version.md5 == md5)
}

/// Find a catalog version by its display version for the given `dll_type`.
pub fn find_by_version<'a>(
    catalog: &'a DllCatalog,
    dll_type: DllType,
    version: &str,
) -> Option<&'a DllVersion> {
    let list = match dll_type {
        DllType::SuperResolution => &catalog.super_resolution,
        DllType::FrameGeneration => &catalog.frame_generation,
        DllType::RayReconstruction => &catalog.ray_reconstruction,
    };
    list.iter().find(|candidate| candidate.version == version)
}
