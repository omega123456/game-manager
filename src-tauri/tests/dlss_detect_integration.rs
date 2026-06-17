//! DLSS detection integration tests (Phase 2).
//!
//! Exercises folder resolution, the recursive NGX-DLL scan, MD5→catalog
//! matching, and persistence to `game_dlss_state` over tempdir fixtures with a
//! fake [`FileVersionReader`] (no real signed DLLs needed).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use game_manager_lib::db::connection::open_in_memory;
use game_manager_lib::db::repo::games::{self, NewGame};
use game_manager_lib::domain::{CatalogSource, DllCatalog, DllType, DllVersion, MonitorMode};
use game_manager_lib::dlss::detect::{
    self, DllIdentity, FileVersionReader, RealFileVersionReader,
};
use game_manager_lib::state::AppState;
use tempfile::TempDir;

/// A fake reader mapping known absolute paths to canned identities.
struct FakeReader {
    map: HashMap<PathBuf, DllIdentity>,
}

impl FileVersionReader for FakeReader {
    fn read(&self, path: &Path) -> game_manager_lib::dlss::DlssResult<DllIdentity> {
        self.map
            .get(path)
            .cloned()
            .ok_or_else(|| game_manager_lib::dlss::DlssError::Io("no identity".into()))
    }
}

fn state_with_app_data(dir: &Path) -> AppState {
    AppState::new_with_app_data_dir(open_in_memory().unwrap(), dir.to_path_buf())
}

fn catalog_with(version: DllVersion) -> DllCatalog {
    let dll_type = version.dll_type;
    let mut catalog = DllCatalog {
        super_resolution: vec![],
        frame_generation: vec![],
        ray_reconstruction: vec![],
        source: CatalogSource::Static,
        fetched_at: None,
    };
    match dll_type {
        DllType::SuperResolution => catalog.super_resolution.push(version),
        DllType::FrameGeneration => catalog.frame_generation.push(version),
        DllType::RayReconstruction => catalog.ray_reconstruction.push(version),
    }
    catalog
}

fn sr_version(md5: &str) -> DllVersion {
    DllVersion {
        dll_type: DllType::SuperResolution,
        version: "3.7".into(),
        version_number: 37,
        label: "v3.7 (Latest)".into(),
        md5: md5.to_string(),
        zip_md5: "deadbeef".into(),
        download_url: "https://example/x.zip".into(),
        file_size_bytes: 1,
        zip_size_bytes: 1,
        is_signature_valid: true,
        is_downloaded: false,
    }
}

fn new_game(launch_target: &str) -> NewGame {
    NewGame {
        name: "Test Game".into(),
        launch_target: launch_target.into(),
        monitor_mode: MonitorMode::Tree,
        monitor_process_name: None,
        arguments: None,
        image_path: None,
    }
}

#[test]
fn resolve_folder_prefers_override() {
    let dir = TempDir::new().unwrap();
    let resolved = detect::resolve_folder(
        Some(dir.path().to_str().unwrap()),
        "steam://run/123",
    );
    assert_eq!(resolved, Some(dir.path().to_path_buf()));
}

#[test]
fn resolve_folder_uses_exe_parent() {
    let dir = TempDir::new().unwrap();
    let exe = dir.path().join("game.exe");
    std::fs::write(&exe, b"x").unwrap();
    let resolved = detect::resolve_folder(None, exe.to_str().unwrap());
    assert_eq!(resolved, Some(dir.path().to_path_buf()));
}

#[test]
fn resolve_folder_none_for_uri() {
    assert_eq!(detect::resolve_folder(None, "steam://run/123"), None);
}

#[test]
fn resolve_folder_none_for_missing_override() {
    assert_eq!(detect::resolve_folder(Some("Z:/does/not/exist"), "x"), None);
}

#[test]
fn find_dll_recurses_subdirs() {
    let dir = TempDir::new().unwrap();
    let nested = dir.path().join("bin").join("plugins");
    std::fs::create_dir_all(&nested).unwrap();
    let dll = nested.join("nvngx_dlss.dll");
    std::fs::write(&dll, b"abc").unwrap();
    let found = detect::find_dll(dir.path(), DllType::SuperResolution);
    assert_eq!(found, Some(dll));
}

#[test]
fn find_dll_none_when_absent() {
    let dir = TempDir::new().unwrap();
    assert_eq!(detect::find_dll(dir.path(), DllType::FrameGeneration), None);
}

#[test]
fn detect_in_folder_matches_catalog_md5() {
    let dir = TempDir::new().unwrap();
    let dll = dir.path().join("nvngx_dlss.dll");
    let bytes = b"dlss-binary-bytes";
    std::fs::write(&dll, bytes).unwrap();
    let md5 = detect::md5_hex(bytes);

    let catalog = catalog_with(sr_version(&md5));
    let mut map = HashMap::new();
    map.insert(
        dll.clone(),
        DllIdentity { md5: md5.clone(), file_version: "3.7.0.0".into() },
    );
    let reader = FakeReader { map };

    let summary = detect::detect_in_folder(dir.path(), &catalog, &reader).unwrap();
    let sr = summary.super_resolution.unwrap();
    assert_eq!(sr.version, "3.7");
    assert_eq!(sr.md5.as_deref(), Some(md5.as_str()));
    assert!(summary.frame_generation.is_none());
}

#[test]
fn detect_in_folder_falls_back_to_file_version() {
    let dir = TempDir::new().unwrap();
    let dll = dir.path().join("nvngx_dlss.dll");
    std::fs::write(&dll, b"unknown").unwrap();
    // Catalog has a different md5, so no match -> use file version.
    let catalog = catalog_with(sr_version("0000"));
    let mut map = HashMap::new();
    map.insert(
        dll.clone(),
        DllIdentity { md5: "ffff".into(), file_version: "2.5.1.0".into() },
    );
    let reader = FakeReader { map };
    let summary = detect::detect_in_folder(dir.path(), &catalog, &reader).unwrap();
    assert_eq!(summary.super_resolution.unwrap().version, "2.5.1");
}

#[test]
fn scan_game_with_persists_state() {
    let app_data = TempDir::new().unwrap();
    let game_dir = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());

    let exe = game_dir.path().join("game.exe");
    std::fs::write(&exe, b"x").unwrap();
    let dll = game_dir.path().join("nvngx_dlss.dll");
    let bytes = b"dlss";
    std::fs::write(&dll, bytes).unwrap();
    let md5 = detect::md5_hex(bytes);

    let game_id = st
        .with_db(|c| games::create(c, &new_game(exe.to_str().unwrap())))
        .unwrap();

    let catalog = catalog_with(sr_version(&md5));
    let mut map = HashMap::new();
    map.insert(dll, DllIdentity { md5, file_version: "3.7.0.0".into() });
    let reader = FakeReader { map };

    let result = detect::scan_game_with(&st, game_id, &catalog, &reader).unwrap();
    assert_eq!(result.super_resolution.as_ref().unwrap().version, "3.7");
    assert!(result.last_scanned_at.is_some());
    assert_eq!(
        result.folder_resolved.as_deref(),
        Some(game_dir.path().to_string_lossy().as_ref())
    );

    // Cached in the session (in-memory) detection store, never in the DB.
    let cached = st.dlss_detection_get(game_id).unwrap();
    assert_eq!(cached.summary.super_resolution.unwrap().version, "3.7");
}

#[test]
fn scan_game_with_no_folder_yields_empty_state() {
    let app_data = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());
    let game_id = st
        .with_db(|c| games::create(c, &new_game("steam://run/9")))
        .unwrap();
    let catalog = catalog_with(sr_version("abc"));
    let reader = FakeReader { map: HashMap::new() };
    let result = detect::scan_game_with(&st, game_id, &catalog, &reader).unwrap();
    assert!(result.super_resolution.is_none());
    assert!(result.folder_resolved.is_none());
    assert!(result.last_scanned_at.is_some());
}

#[test]
fn scan_library_with_scans_all_games() {
    let app_data = TempDir::new().unwrap();
    let game_dir = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());

    let exe = game_dir.path().join("game.exe");
    std::fs::write(&exe, b"x").unwrap();
    let dll = game_dir.path().join("nvngx_dlss.dll");
    let bytes = b"dlss";
    std::fs::write(&dll, bytes).unwrap();
    let md5 = detect::md5_hex(bytes);

    st.with_db(|c| games::create(c, &new_game(exe.to_str().unwrap())))
        .unwrap();
    st.with_db(|c| games::create(c, &new_game("steam://run/2")))
        .unwrap();

    let catalog = catalog_with(sr_version(&md5));
    let mut map = HashMap::new();
    map.insert(dll, DllIdentity { md5, file_version: "3.7.0.0".into() });
    let reader = FakeReader { map };

    let states = detect::scan_library_with(&st, &catalog, &reader).unwrap();
    assert_eq!(states.len(), 2);
}

#[tokio::test]
async fn download_already_present_reports_done() {
    use game_manager_lib::dlss::download::{download_version_impl, ProgressSink};
    use game_manager_lib::dlss::storage;

    let app_data = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());

    // Seed a cached manifest + a local DLL so the download short-circuits.
    let content = b"already-here";
    let md5 = detect::md5_hex(content);
    let dest = storage::local_dll_path(app_data.path(), DllType::SuperResolution, "3.7", &md5);
    std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
    std::fs::write(&dest, content).unwrap();
    let manifest_json = format!(
        r#"{{"dlss":[{{"version":"3.7.0.0","version_number":37,"md5_hash":"{md5}","zip_md5_hash":"zz","download_url":"https://x/x.zip","file_size":1,"zip_file_size":1,"is_signature_valid":true}}],"dlss_g":[],"dlss_d":[]}}"#
    );
    let mp = storage::manifest_path(app_data.path());
    std::fs::create_dir_all(mp.parent().unwrap()).unwrap();
    std::fs::write(&mp, manifest_json).unwrap();

    struct Rec(std::sync::Mutex<bool>);
    impl ProgressSink for Rec {
        fn emit(&self, p: &game_manager_lib::domain::DownloadProgress) {
            if p.done {
                *self.0.lock().unwrap() = true;
            }
        }
    }
    let sink = Rec(std::sync::Mutex::new(false));
    download_version_impl(&st, DllType::SuperResolution, "3.7", &sink)
        .await
        .unwrap();
    assert!(*sink.0.lock().unwrap(), "should report done for present DLL");
}

#[tokio::test]
async fn download_unknown_version_errors() {
    use game_manager_lib::dlss::download::{download_version_impl, NoopProgressSink};
    let app_data = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());
    let err = download_version_impl(&st, DllType::SuperResolution, "99.99", &NoopProgressSink)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("unknown version"));
}

#[test]
fn cancel_download_is_ok() {
    use game_manager_lib::dlss::download::cancel_download_impl;
    let app_data = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());
    cancel_download_impl(&st, DllType::SuperResolution, "3.7").unwrap();
}

#[tokio::test]
async fn stale_cancel_is_cleared_before_non_streaming_download_returns() {
    use game_manager_lib::dlss::download::{
        cancel_download_impl, download_version_impl, is_cancel_pending, NoopProgressSink,
    };
    use game_manager_lib::dlss::storage;

    let app_data = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());
    let dll_content = b"present-dll";
    let md5 = detect::md5_hex(dll_content);
    let dest = storage::local_dll_path(app_data.path(), DllType::SuperResolution, "3.7", &md5);
    std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
    std::fs::write(&dest, dll_content).unwrap();
    let manifest_json = format!(
        r#"{{"dlss":[{{"version":"3.7.0.0","version_number":37,"md5_hash":"{md5}","zip_md5_hash":"zz","download_url":"https://x/x.zip","file_size":1,"zip_file_size":1,"is_signature_valid":true}}],"dlss_g":[],"dlss_d":[]}}"#
    );
    let manifest_path = storage::manifest_path(app_data.path());
    std::fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
    std::fs::write(&manifest_path, manifest_json).unwrap();

    cancel_download_impl(&st, DllType::SuperResolution, "3.7").unwrap();
    assert!(is_cancel_pending(DllType::SuperResolution, "3.7"));

    download_version_impl(&st, DllType::SuperResolution, "3.7", &NoopProgressSink)
        .await
        .unwrap();

    assert!(!is_cancel_pending(DllType::SuperResolution, "3.7"));
}

/// Build a single-entry zip containing `name` → `content` (stored, no compression).
fn build_zip(name: &str, content: &[u8]) -> Vec<u8> {
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut buf);
        let opts = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        writer.start_file(name, opts).unwrap();
        writer.write_all(content).unwrap();
        writer.finish().unwrap();
    }
    buf.into_inner()
}

fn dll_version_for_zip(dll_content: &[u8], zip_bytes: &[u8], url: &str) -> DllVersion {
    DllVersion {
        dll_type: DllType::SuperResolution,
        version: "3.7".into(),
        version_number: 37,
        label: "v3.7".into(),
        md5: detect::md5_hex(dll_content),
        zip_md5: detect::md5_hex(zip_bytes),
        download_url: url.into(),
        file_size_bytes: dll_content.len() as u64,
        zip_size_bytes: zip_bytes.len() as u64,
        is_signature_valid: true,
        is_downloaded: false,
    }
}

#[test]
fn store_zip_bytes_extracts_and_stores() {
    use game_manager_lib::dlss::{download, storage};
    let app_data = TempDir::new().unwrap();
    let dll_content = b"the-dll";
    let zip_bytes = build_zip("nvngx_dlss.dll", dll_content);
    let zip_md5 = detect::md5_hex(&zip_bytes);
    let entry = dll_version_for_zip(dll_content, &zip_bytes, "http://x");

    download::store_zip_bytes(
        app_data.path(),
        DllType::SuperResolution,
        &entry,
        &zip_bytes,
        &zip_md5,
    )
    .unwrap();

    let stored = storage::local_dll_path(app_data.path(), DllType::SuperResolution, "3.7", &entry.md5);
    assert_eq!(std::fs::read(stored).unwrap(), dll_content);
}

#[test]
fn store_zip_bytes_rejects_bad_zip_md5() {
    use game_manager_lib::dlss::download;
    let app_data = TempDir::new().unwrap();
    let dll_content = b"the-dll";
    let zip_bytes = build_zip("nvngx_dlss.dll", dll_content);
    let entry = dll_version_for_zip(dll_content, &zip_bytes, "http://x");
    let err = download::store_zip_bytes(
        app_data.path(),
        DllType::SuperResolution,
        &entry,
        &zip_bytes,
        "wrong-md5",
    )
    .unwrap_err();
    assert!(err.to_string().contains("MD5 mismatch"));
}

#[test]
fn store_zip_bytes_rejects_missing_dll() {
    use game_manager_lib::dlss::download;
    let app_data = TempDir::new().unwrap();
    let zip_bytes = build_zip("readme.txt", b"not a dll");
    let zip_md5 = detect::md5_hex(&zip_bytes);
    let entry = dll_version_for_zip(b"the-dll", &zip_bytes, "http://x");
    let err = download::store_zip_bytes(
        app_data.path(),
        DllType::SuperResolution,
        &entry,
        &zip_bytes,
        &zip_md5,
    )
    .unwrap_err();
    assert!(err.to_string().contains("not found in downloaded zip"));
}

#[test]
fn store_zip_bytes_rejects_bad_dll_md5() {
    use game_manager_lib::dlss::download;
    let app_data = TempDir::new().unwrap();
    // Zip contains a DLL whose md5 differs from the catalog's expected md5.
    let zip_bytes = build_zip("nvngx_dlss.dll", b"actual-bytes");
    let zip_md5 = detect::md5_hex(&zip_bytes);
    let mut entry = dll_version_for_zip(b"expected-bytes", &zip_bytes, "http://x");
    entry.zip_md5 = zip_md5.clone();
    let err = download::store_zip_bytes(
        app_data.path(),
        DllType::SuperResolution,
        &entry,
        &zip_bytes,
        &zip_md5,
    )
    .unwrap_err();
    assert!(err.to_string().contains("extracted DLL MD5 mismatch"));
}

/// Serve `body` once over a one-shot local HTTP/1.1 server; returns the URL.
fn serve_once(body: Vec<u8>) -> String {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf);
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(&body);
            let _ = stream.flush();
        }
    });
    format!("http://127.0.0.1:{port}/x.zip")
}

#[tokio::test]
async fn download_version_streams_verifies_and_stores() {
    use game_manager_lib::dlss::download::{download_version_impl, ProgressSink};
    use game_manager_lib::dlss::storage;

    let app_data = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());

    let dll_content = b"streamed-dll-bytes";
    let zip_bytes = build_zip("nvngx_dlss.dll", dll_content);
    let url = serve_once(zip_bytes.clone());
    let entry = dll_version_for_zip(dll_content, &zip_bytes, &url);

    // Seed a cached manifest carrying this version + hashes + URL.
    let manifest_json = format!(
        r#"{{"dlss":[{{"version":"3.7.0.0","version_number":37,"md5_hash":"{}","zip_md5_hash":"{}","download_url":"{}","file_size":{},"zip_file_size":{},"is_signature_valid":true}}],"dlss_g":[],"dlss_d":[]}}"#,
        entry.md5, entry.zip_md5, url, entry.file_size_bytes, entry.zip_size_bytes
    );
    let mp = storage::manifest_path(app_data.path());
    std::fs::create_dir_all(mp.parent().unwrap()).unwrap();
    std::fs::write(&mp, manifest_json).unwrap();

    struct Counter(std::sync::Mutex<(u32, bool)>);
    impl ProgressSink for Counter {
        fn emit(&self, p: &game_manager_lib::domain::DownloadProgress) {
            let mut guard = self.0.lock().unwrap();
            guard.0 += 1;
            if p.done {
                guard.1 = true;
            }
        }
    }
    let sink = Counter(std::sync::Mutex::new((0, false)));
    download_version_impl(&st, DllType::SuperResolution, "3.7", &sink)
        .await
        .unwrap();

    let guard = sink.0.lock().unwrap();
    assert!(guard.0 >= 2, "expected multiple progress events");
    assert!(guard.1, "expected a done event");
    let stored = storage::local_dll_path(app_data.path(), DllType::SuperResolution, "3.7", &entry.md5);
    assert_eq!(std::fs::read(stored).unwrap(), dll_content);
}

#[tokio::test]
async fn download_version_emits_error_on_bad_url() {
    use game_manager_lib::dlss::download::{download_version_impl, ProgressSink};
    use game_manager_lib::dlss::storage;

    let app_data = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());
    // Unroutable URL → network error → error event emitted.
    let manifest_json = r#"{"dlss":[{"version":"3.7.0.0","version_number":37,"md5_hash":"aa","zip_md5_hash":"bb","download_url":"http://127.0.0.1:1/x.zip","file_size":1,"zip_file_size":1,"is_signature_valid":true}],"dlss_g":[],"dlss_d":[]}"#;
    let mp = storage::manifest_path(app_data.path());
    std::fs::create_dir_all(mp.parent().unwrap()).unwrap();
    std::fs::write(&mp, manifest_json).unwrap();

    struct ErrSink(std::sync::Mutex<bool>);
    impl ProgressSink for ErrSink {
        fn emit(&self, p: &game_manager_lib::domain::DownloadProgress) {
            if p.error.is_some() {
                *self.0.lock().unwrap() = true;
            }
        }
    }
    let sink = ErrSink(std::sync::Mutex::new(false));
    let err = download_version_impl(&st, DllType::SuperResolution, "3.7", &sink)
        .await
        .unwrap_err();
    assert!(matches!(err, game_manager_lib::dlss::DlssError::Network(_)));
    assert!(*sink.0.lock().unwrap(), "error event should be emitted");
}

#[test]
fn scan_game_impl_uses_real_reader_and_cached_manifest() {
    let app_data = TempDir::new().unwrap();
    let game_dir = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());

    let exe = game_dir.path().join("game.exe");
    std::fs::write(&exe, b"x").unwrap();
    let dll = game_dir.path().join("nvngx_dlss.dll");
    let bytes = b"real-scan-dll";
    std::fs::write(&dll, bytes).unwrap();
    let md5 = detect::md5_hex(bytes);

    // Cached manifest matching the on-disk DLL's md5.
    let manifest_json = format!(
        r#"{{"dlss":[{{"version":"3.7.0.0","version_number":37,"md5_hash":"{md5}","zip_md5_hash":"z","download_url":"u","file_size":1,"zip_file_size":1,"is_signature_valid":true}}],"dlss_g":[],"dlss_d":[]}}"#
    );
    let mp = game_manager_lib::dlss::storage::manifest_path(app_data.path());
    std::fs::create_dir_all(mp.parent().unwrap()).unwrap();
    std::fs::write(&mp, manifest_json).unwrap();

    let game_id = st
        .with_db(|c| games::create(c, &new_game(exe.to_str().unwrap())))
        .unwrap();
    let result = detect::scan_game_impl(&st, game_id).unwrap();
    assert_eq!(result.super_resolution.unwrap().version, "3.7");
}

#[test]
fn scan_library_impl_runs_over_all_games() {
    let app_data = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());
    st.with_db(|c| games::create(c, &new_game("steam://run/1")))
        .unwrap();
    // No cached manifest → falls back to static; no folder → empty state.
    let states = detect::scan_library_impl(&st).unwrap();
    assert_eq!(states.len(), 1);
    assert!(states[0].super_resolution.is_none());
}

#[test]
fn real_reader_reads_md5_without_version_resource() {
    // A plain file has no version resource but still hashes; this covers the
    // real reader's hashing path without needing a signed DLL.
    let dir = TempDir::new().unwrap();
    let dll = dir.path().join("nvngx_dlss.dll");
    std::fs::write(&dll, b"hello").unwrap();
    let reader = RealFileVersionReader;
    let identity = reader.read(&dll).unwrap();
    assert_eq!(identity.md5, detect::md5_hex(b"hello"));
}
