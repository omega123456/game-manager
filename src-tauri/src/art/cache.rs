//! Local image-cache helpers for selected remote art candidates.

use std::fs;
use std::path::{Path, PathBuf};

use reqwest::blocking::Client;
use reqwest::header::CONTENT_TYPE;
use reqwest::Url;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

const CACHE_DIR_NAME: &str = "art-cache";

/// Host suffixes whose images the renderer is allowed to ask us to cache.
/// Scoped to the art providers wired up today (Steam CDN + SteamGridDB).
const ALLOWED_ART_HOST_SUFFIXES: &[&str] = &["steamstatic.com", "steamgriddb.com"];

/// Maximum number of bytes we will persist for a single cached cover image.
const MAX_ART_BYTES: usize = 16 * 1024 * 1024;

#[cfg(feature = "test-utils")]
fn is_test_localhost_host(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost")
}

fn host_is_allowed(host: &str) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    #[cfg(feature = "test-utils")]
    if is_test_localhost_host(&host) {
        return true;
    }
    ALLOWED_ART_HOST_SUFFIXES.iter().any(|suffix| {
        host == *suffix || host.ends_with(&format!(".{suffix}"))
    })
}

/// Validate that a remote art URL is an https URL on an allowlisted provider host.
///
/// This is the trust boundary for `cache_art_candidate`: the renderer can pass
/// arbitrary strings, so we reject anything that is not https or not served by a
/// known art provider before issuing an outbound request.
pub fn validate_remote_art_url(url: &str) -> AppResult<()> {
    let parsed = Url::parse(url.trim())
        .map_err(|err| AppError::other(format!("invalid art url: {err}")))?;

    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::other("art url is missing a host"))?;

    #[cfg(feature = "test-utils")]
    if is_test_localhost_host(host) && parsed.scheme() == "http" {
        return Ok(());
    }

    if parsed.scheme() != "https" {
        return Err(AppError::other(format!(
            "rejected art url scheme: {}",
            parsed.scheme()
        )));
    }

    if !host_is_allowed(host) {
        return Err(AppError::other(format!("art url host not allowed: {host}")));
    }

    Ok(())
}

/// Heuristic check that a downloaded payload is actually a supported image.
///
/// Guards against an allowlisted host (or a redirect) returning HTML/JSON or
/// some other non-image body that we would otherwise persist as cover art.
fn looks_like_supported_image(content_type: Option<&str>, bytes: &[u8]) -> bool {
    if let Some(content_type) = content_type {
        let normalized = content_type.split(';').next().unwrap_or("").trim();
        if normalized.eq_ignore_ascii_case("image/png")
            || normalized.eq_ignore_ascii_case("image/jpeg")
            || normalized.eq_ignore_ascii_case("image/jpg")
            || normalized.eq_ignore_ascii_case("image/webp")
        {
            return true;
        }
        // A present-but-non-image content type is a hard reject.
        if normalized.starts_with("text/") || normalized == "application/json" {
            return false;
        }
    }

    has_image_magic_bytes(bytes)
}

fn has_image_magic_bytes(bytes: &[u8]) -> bool {
    // PNG
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        return true;
    }
    // JPEG
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return true;
    }
    // WEBP: "RIFF" .... "WEBP"
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return true;
    }
    false
}

fn hex_digest(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let bytes = hasher.finalize();
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn extension_from_url(url: &str) -> Option<&str> {
    let clean = url.split('?').next().unwrap_or(url);
    Path::new(clean)
        .extension()
        .and_then(|ext| ext.to_str())
        .filter(|ext| !ext.is_empty())
}

fn extension_from_content_type(content_type: Option<&str>) -> &'static str {
    match content_type.unwrap_or_default() {
        "image/png" => "png",
        "image/webp" => "webp",
        "image/jpeg" | "image/jpg" => "jpg",
        _ => "img",
    }
}

/// Build the deterministic on-disk cache path for a remote art URL.
pub fn build_cache_path(app_data_dir: &Path, url: &str, content_type: Option<&str>) -> PathBuf {
    let ext = extension_from_url(url).unwrap_or_else(|| extension_from_content_type(content_type));
    app_data_dir
        .join(CACHE_DIR_NAME)
        .join(format!("{}.{}", hex_digest(url), ext))
}

/// Persist already-downloaded image bytes into the app-data art cache.
pub fn write_bytes(
    app_data_dir: &Path,
    url: &str,
    bytes: &[u8],
    content_type: Option<&str>,
) -> AppResult<String> {
    let path = build_cache_path(app_data_dir, url, content_type);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| AppError::Io(format!("create art cache dir: {err}")))?;
    }
    fs::write(&path, bytes).map_err(|err| AppError::Io(format!("write art cache file: {err}")))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Download a remote art URL and persist it into the local cache.
pub fn cache_remote_image(client: &Client, app_data_dir: &Path, url: &str) -> AppResult<String> {
    let response = client
        .get(url)
        .send()
        .map_err(|err| AppError::other(format!("download art candidate: {err}")))?;
    if !response.status().is_success() {
        return Err(AppError::other(format!(
            "download art candidate failed with status {}",
            response.status()
        )));
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let bytes = response
        .bytes()
        .map_err(|err| AppError::other(format!("read art candidate response: {err}")))?;

    if bytes.len() > MAX_ART_BYTES {
        return Err(AppError::other(format!(
            "art candidate exceeds {MAX_ART_BYTES} byte limit"
        )));
    }

    if !looks_like_supported_image(content_type.as_deref(), bytes.as_ref()) {
        return Err(AppError::other(
            "art candidate response is not a supported image".to_string(),
        ));
    }

    write_bytes(app_data_dir, url, bytes.as_ref(), content_type.as_deref())
}
