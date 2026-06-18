//! DLSS manifest + storage integration tests.
//!
//! Exercises parsing the bundled static manifest, the offline `build_catalog`
//! fallback chain (cache → static), MD5/version lookup, display-version
//! trimming, the storage path layout, and `is_downloaded` flagging — all against
//! tempdirs with no network access.

use game_manager_lib::dlss::{display_version, manifest, storage};
use game_manager_lib::domain::{CatalogSource, DllType};
use game_manager_lib::state::AppState;
use std::sync::{Mutex, OnceLock};

struct EnvGuard {
    key: &'static str,
    previous: Option<String>,
}

impl EnvGuard {
    fn set(key: &'static str, value: &str) -> Self {
        let previous = std::env::var(key).ok();
        std::env::set_var(key, value);
        Self { key, previous }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        if let Some(value) = &self.previous {
            std::env::set_var(self.key, value);
        } else {
            std::env::remove_var(self.key);
        }
    }
}

fn proxy_env_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
}

#[test]
fn static_manifest_parses_into_all_three_types() {
    let catalog = manifest::load_static().expect("static manifest must parse");
    assert_eq!(catalog.source, CatalogSource::Static);
    assert!(!catalog.super_resolution.is_empty());
    assert!(!catalog.frame_generation.is_empty());
    assert!(!catalog.ray_reconstruction.is_empty());
}

#[test]
fn versions_are_sorted_newest_first_and_latest_labeled() {
    let catalog = manifest::load_static().unwrap();
    let sr = &catalog.super_resolution;
    // Newest first.
    for pair in sr.windows(2) {
        assert!(pair[0].version_number >= pair[1].version_number);
    }
    // The newest version carries a "(Latest)" marker.
    assert!(sr[0].label.contains("Latest"), "label was {}", sr[0].label);
}

#[test]
fn display_version_trims_trailing_zero_components() {
    assert_eq!(display_version("3.7.0.0"), "3.7");
    assert_eq!(display_version("3.7.10.0"), "3.7.10");
    assert_eq!(display_version("2.5.1.0"), "2.5.1");
    // Never collapse to empty.
    assert_eq!(display_version("0.0"), "0");
}

#[test]
fn find_by_md5_matches_the_right_type() {
    let catalog = manifest::load_static().unwrap();
    let target = &catalog.super_resolution[0];
    let found = manifest::find_by_md5(&catalog, DllType::SuperResolution, &target.md5)
        .expect("md5 must resolve");
    assert_eq!(found.version, target.version);
    // A wrong type does not match the same hash.
    assert!(manifest::find_by_md5(&catalog, DllType::RayReconstruction, &target.md5).is_none());
}

#[test]
fn find_by_version_resolves_display_version() {
    let catalog = manifest::load_static().unwrap();
    let target = catalog.frame_generation[0].version.clone();
    let found = manifest::find_by_version(&catalog, DllType::FrameGeneration, &target)
        .expect("version must resolve");
    assert_eq!(found.version, target);
    assert!(manifest::find_by_version(&catalog, DllType::FrameGeneration, "0.0.0").is_none());
}

#[test]
fn find_by_md5_matches_frame_generation_case_insensitively() {
    let catalog = manifest::load_static().unwrap();
    let target = &catalog.frame_generation[0];
    let found = manifest::find_by_md5(
        &catalog,
        DllType::FrameGeneration,
        &target.md5.to_uppercase(),
    )
    .expect("frame-generation md5 must resolve case-insensitively");
    assert_eq!(found.version, target.version);
}

#[test]
fn find_by_version_resolves_ray_reconstruction() {
    let catalog = manifest::load_static().unwrap();
    let target = catalog.ray_reconstruction[0].version.clone();
    let found = manifest::find_by_version(&catalog, DllType::RayReconstruction, &target)
        .expect("ray-reconstruction version must resolve");
    assert_eq!(found.version, target);
}

#[test]
fn md5_index_covers_every_version() {
    let catalog = manifest::load_static().unwrap();
    let index = manifest::md5_index(&catalog);
    let total = catalog.super_resolution.len()
        + catalog.frame_generation.len()
        + catalog.ray_reconstruction.len();
    assert_eq!(index.len(), total);
}

#[tokio::test]
async fn build_catalog_offline_falls_back_to_static() {
    let dir = tempfile::tempdir().unwrap();
    // No cache file exists; refresh=false → static fallback.
    let catalog = manifest::build_catalog(dir.path(), false).await.unwrap();
    assert_eq!(catalog.source, CatalogSource::Static);
    assert!(!catalog.super_resolution.is_empty());
}

#[tokio::test]
async fn build_catalog_prefers_cache_when_present() {
    let dir = tempfile::tempdir().unwrap();
    // Seed a minimal cache file with a single SR record.
    let cache_body = r#"{ "dlss": [
        { "version": "9.9.9.0", "version_number": 9009009000, "md5_hash": "abc",
          "zip_md5_hash": "def", "download_url": "http://x", "file_size": 1,
          "zip_file_size": 1, "is_signature_valid": true } ],
        "dlss_g": [], "dlss_d": [] }"#;
    std::fs::create_dir_all(storage::root(dir.path())).unwrap();
    std::fs::write(storage::manifest_path(dir.path()), cache_body).unwrap();

    let catalog = manifest::build_catalog(dir.path(), false).await.unwrap();
    assert_eq!(catalog.source, CatalogSource::Cache);
    assert_eq!(catalog.super_resolution.len(), 1);
    assert_eq!(catalog.super_resolution[0].version, "9.9.9");
}

#[test]
fn storage_paths_are_under_the_dlss_root() {
    let base = std::path::Path::new("C:/app-data");
    let root = storage::root(base);
    assert!(root.ends_with("dlss"));
    assert!(storage::manifest_path(base).starts_with(&root));
    assert!(storage::temp_dir(base).starts_with(&root));
    let sr_dir = storage::dll_type_dir(base, DllType::SuperResolution);
    assert!(sr_dir.ends_with("sr"));
}

#[test]
fn local_dll_path_uses_version_and_filename() {
    let base = std::path::Path::new("C:/app-data");
    let path = storage::local_dll_path(base, DllType::SuperResolution, "3.7.10", "deadbeef");
    assert!(path.ends_with("nvngx_dlss.dll"));
    assert!(path.to_string_lossy().contains("3.7.10_deadbeef"));
}

#[test]
fn is_downloaded_reflects_disk_presence() {
    let dir = tempfile::tempdir().unwrap();
    let dll_type = DllType::SuperResolution;
    assert!(!storage::is_downloaded(dir.path(), dll_type, "3.7", "hash"));

    let path = storage::local_dll_path(dir.path(), dll_type, "3.7", "hash");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, b"dll").unwrap();
    assert!(storage::is_downloaded(dir.path(), dll_type, "3.7", "hash"));
}

#[tokio::test]
async fn build_catalog_refresh_attempts_remote_then_falls_back() {
    // Seed a cache so the fallback path is deterministic when the network is
    // unavailable (CI). When the network IS available the remote path is taken.
    // Either way the refresh branch + fallback chain is exercised and a usable
    // catalog is returned.
    let dir = tempfile::tempdir().unwrap();
    let cache_body = r#"{ "dlss": [
        { "version": "1.2.3.0", "version_number": 1002003000, "md5_hash": "h",
          "zip_md5_hash": "z", "download_url": "http://x", "file_size": 1,
          "zip_file_size": 1, "is_signature_valid": true } ],
        "dlss_g": [], "dlss_d": [] }"#;
    std::fs::create_dir_all(storage::root(dir.path())).unwrap();
    std::fs::write(storage::manifest_path(dir.path()), cache_body).unwrap();

    let catalog = manifest::build_catalog(dir.path(), true).await.unwrap();
    assert!(matches!(
        catalog.source,
        CatalogSource::Remote | CatalogSource::Cache | CatalogSource::Static
    ));
}

#[tokio::test]
async fn build_catalog_refresh_uses_cache_when_remote_fetch_cannot_connect() {
    let _lock = proxy_env_lock();
    let _http_proxy = EnvGuard::set("HTTP_PROXY", "http://127.0.0.1:1");
    let _https_proxy = EnvGuard::set("HTTPS_PROXY", "http://127.0.0.1:1");
    let _http_proxy_lower = EnvGuard::set("http_proxy", "http://127.0.0.1:1");
    let _https_proxy_lower = EnvGuard::set("https_proxy", "http://127.0.0.1:1");
    let _no_proxy = EnvGuard::set("NO_PROXY", "");
    let _no_proxy_lower = EnvGuard::set("no_proxy", "");

    let dir = tempfile::tempdir().unwrap();
    let cache_body = r#"{ "dlss": [
        { "version": "8.8.8.0", "version_number": 8008008000, "md5_hash": "abc",
          "zip_md5_hash": "def", "download_url": "http://x", "file_size": 1,
          "zip_file_size": 1, "is_signature_valid": true } ],
        "dlss_g": [], "dlss_d": [] }"#;
    std::fs::create_dir_all(storage::root(dir.path())).unwrap();
    std::fs::write(storage::manifest_path(dir.path()), cache_body).unwrap();

    let catalog = manifest::build_catalog(dir.path(), true).await.unwrap();
    assert_eq!(catalog.source, CatalogSource::Cache);
    assert_eq!(catalog.super_resolution[0].version, "8.8.8");
}

#[test]
fn parse_remote_records_with_additional_label() {
    let body = r#"{ "dlss": [
        { "version": "3.8.0.0", "version_number": 3008000000,
          "additional_label": "New", "md5_hash": "AABB", "zip_md5_hash": "CCDD",
          "download_url": "http://x", "file_size": 10, "zip_file_size": 5,
          "is_signature_valid": false } ],
        "dlss_g": [], "dlss_d": [] }"#;
    let catalog = manifest::parse(
        body,
        CatalogSource::Remote,
        Some("2026-06-17T00:00:00Z".into()),
    )
    .unwrap();
    let sr = &catalog.super_resolution[0];
    assert_eq!(sr.label, "v3.8 (New)");
    // Hashes are lowercased.
    assert_eq!(sr.md5, "aabb");
    assert_eq!(sr.zip_md5, "ccdd");
    assert!(!sr.is_signature_valid);
    assert_eq!(catalog.fetched_at.as_deref(), Some("2026-06-17T00:00:00Z"));
}

#[test]
fn parse_deduplicates_duplicate_display_versions_per_dll_type() {
    let body = r#"{ "dlss": [
        { "version": "3.8.0.0", "version_number": 3008000000, "md5_hash": "aaaa",
          "zip_md5_hash": "bbbb", "download_url": "http://one", "file_size": 10,
          "zip_file_size": 5, "is_signature_valid": true },
        { "version": "3.8.0.0", "version_number": 3008000000, "md5_hash": "cccc",
          "zip_md5_hash": "dddd", "download_url": "http://two", "file_size": 11,
          "zip_file_size": 6, "is_signature_valid": true } ],
        "dlss_g": [], "dlss_d": [] }"#;

    let catalog = manifest::parse(body, CatalogSource::Remote, None).unwrap();

    assert_eq!(catalog.super_resolution.len(), 1);
    assert_eq!(catalog.super_resolution[0].version, "3.8");
    assert_eq!(catalog.super_resolution[0].md5, "aaaa");
}

#[tokio::test]
async fn resolve_catalog_attempts_remote_refresh_only_once_per_session() {
    let _lock = proxy_env_lock();
    let _http_proxy = EnvGuard::set("HTTP_PROXY", "http://127.0.0.1:1");
    let _https_proxy = EnvGuard::set("HTTPS_PROXY", "http://127.0.0.1:1");
    let _http_proxy_lower = EnvGuard::set("http_proxy", "http://127.0.0.1:1");
    let _https_proxy_lower = EnvGuard::set("https_proxy", "http://127.0.0.1:1");
    let _no_proxy = EnvGuard::set("NO_PROXY", "");
    let _no_proxy_lower = EnvGuard::set("no_proxy", "");

    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new_with_app_data_dir(
        game_manager_lib::db::connection::open_in_memory().unwrap(),
        dir.path().to_path_buf(),
    );

    let cache_v1 = r#"{ "dlss": [
        { "version": "1.2.3.0", "version_number": 1002003000, "md5_hash": "aaa",
          "zip_md5_hash": "bbb", "download_url": "http://x", "file_size": 1,
          "zip_file_size": 1, "is_signature_valid": true } ],
        "dlss_g": [], "dlss_d": [] }"#;
    std::fs::create_dir_all(storage::root(dir.path())).unwrap();
    std::fs::write(storage::manifest_path(dir.path()), cache_v1).unwrap();

    let startup_catalog = manifest::resolve_catalog(&state, false).await.unwrap();
    assert_eq!(startup_catalog.super_resolution[0].version, "1.2.3");

    let cache_v2 = r#"{ "dlss": [
        { "version": "2.3.4.0", "version_number": 2003004000, "md5_hash": "ccc",
          "zip_md5_hash": "ddd", "download_url": "http://y", "file_size": 1,
          "zip_file_size": 1, "is_signature_valid": true } ],
        "dlss_g": [], "dlss_d": [] }"#;
    std::fs::write(storage::manifest_path(dir.path()), cache_v2).unwrap();

    let refreshed_catalog = manifest::resolve_catalog(&state, true).await.unwrap();
    assert_eq!(refreshed_catalog.source, CatalogSource::Cache);
    assert_eq!(refreshed_catalog.super_resolution[0].version, "2.3.4");

    let cache_v3 = r#"{ "dlss": [
        { "version": "3.4.5.0", "version_number": 3004005000, "md5_hash": "eee",
          "zip_md5_hash": "fff", "download_url": "http://z", "file_size": 1,
          "zip_file_size": 1, "is_signature_valid": true } ],
        "dlss_g": [], "dlss_d": [] }"#;
    std::fs::write(storage::manifest_path(dir.path()), cache_v3).unwrap();

    let second_refresh = manifest::resolve_catalog(&state, true).await.unwrap();
    assert_eq!(second_refresh.super_resolution[0].version, "2.3.4");
}

#[tokio::test]
async fn build_catalog_applies_downloaded_flag() {
    let dir = tempfile::tempdir().unwrap();
    let catalog_before = manifest::build_catalog(dir.path(), false).await.unwrap();
    let sr = &catalog_before.super_resolution[0];
    assert!(!sr.is_downloaded);

    // Materialize the DLL on disk, then re-resolve.
    let path = storage::local_dll_path(dir.path(), sr.dll_type, &sr.version, &sr.md5);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, b"dll").unwrap();
    let catalog_after = manifest::build_catalog(dir.path(), false).await.unwrap();
    assert!(catalog_after.super_resolution[0].is_downloaded);
}

#[test]
fn parse_rejects_invalid_json() {
    let err = manifest::parse("not json", CatalogSource::Static, None).unwrap_err();
    assert!(err.to_string().contains("parse manifest"));
}

#[test]
fn load_cache_returns_none_when_absent() {
    let dir = tempfile::tempdir().unwrap();
    assert!(manifest::load_cache(dir.path()).unwrap().is_none());
}

#[test]
fn load_cache_propagates_invalid_json() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(storage::root(dir.path())).unwrap();
    std::fs::write(storage::manifest_path(dir.path()), "{ broken").unwrap();
    assert!(manifest::load_cache(dir.path()).is_err());
}

#[test]
fn ensure_dirs_create_the_layout() {
    let dir = tempfile::tempdir().unwrap();
    let dll_dir = storage::ensure_dll_type_dir(dir.path(), DllType::FrameGeneration).unwrap();
    assert!(dll_dir.is_dir());
    let temp = storage::ensure_temp_dir(dir.path()).unwrap();
    assert!(temp.is_dir());
}

#[test]
fn version_key_strips_unsafe_characters() {
    let key = storage::version_key("3.7/../x", "ab/cd");
    assert!(!key.contains('/'));
    assert!(key.contains("3.7"));
}

#[test]
fn dlss_error_maps_into_app_error() {
    use game_manager_lib::dlss::DlssError;
    use game_manager_lib::error::AppError;

    let app: AppError = DlssError::Database("db".into()).into();
    assert!(matches!(app, AppError::Database(_)));
    let app: AppError = DlssError::Io("io".into()).into();
    assert!(matches!(app, AppError::Io(_)));
    let app: AppError = DlssError::Unimplemented.into();
    assert!(matches!(app, AppError::Other(_)));

    // The reverse conversion (AppError → DlssError).
    let back: DlssError = AppError::Io("x".into()).into();
    assert!(matches!(back, DlssError::Io(_)));
    let back: DlssError = AppError::Database("y".into()).into();
    assert!(matches!(back, DlssError::Database(_)));
    let back: DlssError = AppError::Other("z".into()).into();
    assert!(matches!(back, DlssError::Invalid(_)));

    // std::io::Error bridge.
    let io = std::io::Error::new(std::io::ErrorKind::Other, "boom");
    let back: DlssError = io.into();
    assert!(matches!(back, DlssError::Io(_)));
}

#[test]
fn dll_type_metadata_is_consistent() {
    assert_eq!(DllType::SuperResolution.dll_filename(), "nvngx_dlss.dll");
    assert_eq!(DllType::FrameGeneration.dll_filename(), "nvngx_dlssg.dll");
    assert_eq!(DllType::RayReconstruction.dll_filename(), "nvngx_dlssd.dll");
    assert_eq!(DllType::SuperResolution.manifest_key(), "dlss");
    assert_eq!(DllType::FrameGeneration.manifest_key(), "dlss_g");
    assert_eq!(DllType::RayReconstruction.manifest_key(), "dlss_d");
    assert_eq!(DllType::ALL.len(), 3);
}

#[test]
fn nvapi_probe_does_not_panic() {
    // On CI (no NVIDIA driver) this is false; the call must be safe regardless.
    let _ = game_manager_lib::dlss::nvapi::is_nvapi_available();
}

#[test]
fn preset_options_load_for_both_kinds() {
    use game_manager_lib::dlss::nvapi::presets::preset_options;
    use game_manager_lib::domain::PresetKind;

    let sr = preset_options(PresetKind::Dlss).unwrap();
    assert!(sr.iter().any(|p| p.name == "Default" && p.value == 0));
    assert!(sr.iter().any(|p| p.value == 0x00FF_FFFF));

    let rr = preset_options(PresetKind::RayReconstruction).unwrap();
    assert!(rr.iter().any(|p| p.name == "Default"));
    // RR Preset A is deprecated.
    assert!(rr.iter().any(|p| p.value == 1 && p.deprecated));
}
