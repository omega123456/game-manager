//! Art command + provider integration tests for Phase B3.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::thread;

struct EnvGuard {
    key: &'static str,
    previous: Option<String>,
}

impl EnvGuard {
    fn set(key: &'static str, value: impl AsRef<str>) -> Self {
        let previous = std::env::var(key).ok();
        std::env::set_var(key, value.as_ref());
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

use game_manager_lib::art::{cache, steam, steamgriddb};
use game_manager_lib::commands::art::{
    cache_art_candidate_impl, fetch_metadata_impl, fetch_metadata_with_provider, search_art_impl,
    search_art_with_providers,
};
use game_manager_lib::commands::settings::set_setting_impl;
use game_manager_lib::db::repo::logs;
use game_manager_lib::domain::{ArtSource, MetadataResult};
use game_manager_lib::state::AppState;
use tempfile::TempDir;

fn fixture(name: &str) -> &'static str {
    match name {
        "steamgriddb-search" => include_str!("fixtures/steamgriddb-search.json"),
        "steamgriddb-grids" => include_str!("fixtures/steamgriddb-grids.json"),
        "steam-app-list" => include_str!("fixtures/steam-app-list.json"),
        _ => panic!("unknown fixture: {name}"),
    }
}

fn temp_state() -> (AppState, TempDir) {
    let dir = TempDir::new().unwrap();
    let state = AppState::new_with_app_data_dir(
        game_manager_lib::db::connection::open_in_memory().unwrap(),
        dir.path().to_path_buf(),
    );
    (state, dir)
}

fn log_messages(state: &AppState) -> Vec<String> {
    state
        .with_db(|conn| Ok(logs::list_recent(conn, 20)?))
        .unwrap()
        .into_iter()
        .map(|entry| entry.message)
        .collect()
}

fn spawn_image_server(
    body: &'static [u8],
    content_type: &'static str,
) -> (String, thread::JoinHandle<()>) {
    spawn_image_server_with_path("/cover.png", body, content_type)
}

fn spawn_image_server_with_path(
    path: &str,
    body: &'static [u8],
    content_type: &'static str,
) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let path = path.to_string();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request_buf = [0_u8; 1024];
        let _ = stream.read(&mut request_buf);
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(response.as_bytes()).unwrap();
        stream.write_all(body).unwrap();
        let _ = path;
    });
    (format!("http://{addr}{path}"), handle)
}

fn spawn_fixture_server(
    routes: &[(&str, &str)],
    max_requests: usize,
) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let routes: Vec<(String, String)> = routes
        .iter()
        .map(|(path, body)| ((*path).to_string(), (*body).to_string()))
        .collect();
    let handle = thread::spawn(move || {
        for _ in 0..max_requests {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request_buf = [0_u8; 4096];
            let read = stream.read(&mut request_buf).unwrap_or(0);
            let request = String::from_utf8_lossy(&request_buf[..read]);
            let request_path = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("");
            let body = routes
                .iter()
                .find(|(path, _)| request_path.starts_with(path))
                .map(|(_, body)| body.clone())
                .unwrap_or_else(|| "{}".to_string());
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
        }
    });
    (format!("http://{addr}"), handle)
}

#[test]
fn parses_steamgriddb_fixtures_into_portrait_candidates() {
    let game_ids = steamgriddb::parse_search_game_ids(fixture("steamgriddb-search")).unwrap();
    assert_eq!(game_ids, vec![730, 12345]);

    let candidates = steamgriddb::parse_grid_candidates(fixture("steamgriddb-grids")).unwrap();
    assert_eq!(candidates.len(), 2);
    assert_eq!(candidates[0].id, "sgdb-101");
    assert_eq!(candidates[0].width, 600);
    assert_eq!(candidates[0].height, 900);
    assert_eq!(candidates[0].provider_name, "SteamGridDB");
}

#[test]
fn parses_steam_fixture_into_matches_cover_candidates_and_metadata() {
    let matches = steam::parse_app_matches(fixture("steam-app-list"), "hades", 4).unwrap();
    assert_eq!(matches[0].name, "Hades");
    assert_eq!(matches[1].name, "Hades II");

    let candidates = steam::cover_candidates(&matches[..2]);
    assert_eq!(candidates.len(), 2);
    assert_eq!(
        candidates[0].image_url,
        "https://cdn.akamai.steamstatic.com/steam/apps/1145350/library_600x900.jpg"
    );
    assert_eq!(candidates[0].width, 600);
    assert_eq!(candidates[0].height, 900);
}

#[test]
fn cache_path_is_deterministic_and_prefers_url_extension() {
    let root = PathBuf::from("C:/cache-root");
    let path_a = cache::build_cache_path(&root, "https://cdn.example.test/cover.png?x=1", None);
    let path_b = cache::build_cache_path(
        &root,
        "https://cdn.example.test/cover.png?x=1",
        Some("image/webp"),
    );
    let path_c =
        cache::build_cache_path(&root, "https://cdn.example.test/other", Some("image/webp"));

    assert_eq!(path_a, path_b);
    assert_eq!(path_a.extension().and_then(|ext| ext.to_str()), Some("png"));
    assert_eq!(
        path_c.extension().and_then(|ext| ext.to_str()),
        Some("webp")
    );
}

#[test]
fn missing_keys_degrade_gracefully_and_log() {
    let (state, _dir) = temp_state();

    let art = search_art_impl(&state, "Alan Wake 2").unwrap();
    assert!(art.is_empty());

    let metadata = fetch_metadata_impl(&state, "Alan Wake 2").unwrap();
    assert_eq!(metadata.canonical_name, "Alan Wake 2");

    let messages = log_messages(&state);
    assert!(messages.contains(&"SteamGridDB art search skipped".to_string()));
    assert!(messages.contains(&"Steam metadata fallback art search skipped".to_string()));
    assert!(messages.contains(&"Steam metadata lookup skipped".to_string()));
}

#[test]
fn offline_failures_degrade_gracefully_and_log() {
    let (state, _dir) = temp_state();
    set_setting_impl(&state, "steamgriddb_api_key", "sgdb-key").unwrap();
    set_setting_impl(&state, "steam_api_key", "steam-key").unwrap();

    let art = search_art_with_providers(
        &state,
        "Alan Wake 2",
        &|_, _, _| Err(game_manager_lib::error::AppError::other("sgdb offline")),
        &|_, _, _| Err(game_manager_lib::error::AppError::other("steam offline")),
    )
    .unwrap();
    assert!(art.is_empty());

    let metadata = fetch_metadata_with_provider(&state, "Alan Wake 2", &|_, _, _| {
        Err(game_manager_lib::error::AppError::other("steam offline"))
    })
    .unwrap();
    assert_eq!(metadata.canonical_name, "Alan Wake 2");

    let messages = log_messages(&state);
    assert!(messages.contains(&"SteamGridDB art search failed".to_string()));
    assert!(messages.contains(&"Steam metadata fallback art search failed".to_string()));
    assert!(messages.contains(&"Steam metadata lookup failed".to_string()));
}

#[test]
fn cache_remote_image_downloads_to_local_image_path() {
    let (_state, dir) = temp_state();
    let image_bytes = b"\x89PNG\r\n\x1a\nfakepng";
    let (url, handle) = spawn_image_server(image_bytes, "image/png");

    let client = reqwest::blocking::Client::new();
    let cached_path = cache::cache_remote_image(&client, dir.path(), &url).unwrap();
    handle.join().unwrap();

    let cached = std::fs::read(&cached_path).unwrap();
    assert_eq!(cached, image_bytes);
    assert!(cached_path.contains("art-cache"));
}

#[test]
fn cache_remote_image_rejects_non_image_payload() {
    let (_state, dir) = temp_state();
    let (url, handle) = spawn_image_server(b"<html>not an image</html>", "text/html");

    let client = reqwest::blocking::Client::new();
    let result = cache::cache_remote_image(&client, dir.path(), &url);
    handle.join().unwrap();

    assert!(result.is_err());
}

#[test]
fn cache_remote_image_accepts_images_by_magic_bytes_for_unknown_content_type() {
    let client = reqwest::blocking::Client::new();
    let cases: [&'static [u8]; 3] = [
        b"\x89PNG\r\n\x1a\nrest-of-png",
        b"\xFF\xD8\xFFjpeg-bytes",
        b"RIFF\x00\x00\x00\x00WEBPrest",
    ];
    for body in cases {
        let (_state, dir) = temp_state();
        let (url, handle) = spawn_image_server(body, "application/octet-stream");
        let cached_path = cache::cache_remote_image(&client, dir.path(), &url).unwrap();
        handle.join().unwrap();
        assert!(cached_path.contains("art-cache"));
    }
}

#[test]
fn cache_remote_image_rejects_unknown_content_type_without_image_magic() {
    let (_state, dir) = temp_state();
    let (url, handle) = spawn_image_server(b"not-an-image-at-all", "application/octet-stream");

    let client = reqwest::blocking::Client::new();
    let result = cache::cache_remote_image(&client, dir.path(), &url);
    handle.join().unwrap();

    assert!(result.is_err());
}

#[test]
fn validate_remote_art_url_allows_provider_hosts() {
    cache::validate_remote_art_url(
        "https://cdn.akamai.steamstatic.com/steam/apps/730/library_600x900.jpg",
    )
    .unwrap();
    cache::validate_remote_art_url("https://cdn2.steamgriddb.com/grid/abc.png").unwrap();
}

#[test]
fn validate_remote_art_url_rejects_bad_scheme_and_host() {
    assert!(cache::validate_remote_art_url("http://cdn.akamai.steamstatic.com/x.png").is_err());
    assert!(cache::validate_remote_art_url("https://evil.example.com/x.png").is_err());
    assert!(cache::validate_remote_art_url("https://steamgriddb.com.evil.com/x.png").is_err());
    assert!(cache::validate_remote_art_url("not a url").is_err());
}

#[test]
fn cache_art_candidate_rejects_unsafe_url_and_logs() {
    let (state, _dir) = temp_state();

    let result = cache_art_candidate_impl(&state, "https://evil.example.com/cover.png");
    assert!(result.is_err());

    let messages = log_messages(&state);
    assert!(messages.contains(&"Art candidate cache rejected unsafe url".to_string()));
}

#[test]
fn steamgriddb_search_grids_round_trips_through_mock_server() {
    let (base, handle) = spawn_fixture_server(
        &[
            ("/search", fixture("steamgriddb-search")),
            ("/grids/730", fixture("steamgriddb-grids")),
        ],
        2,
    );
    let _search = EnvGuard::set("GM_TEST_STEAMGRIDDB_SEARCH_BASE", format!("{base}/search"));
    let _grid = EnvGuard::set("GM_TEST_STEAMGRIDDB_GRID_BASE", format!("{base}/grids"));
    let client = reqwest::blocking::Client::new();
    let candidates = steamgriddb::search_grids(&client, "sgdb-key", "Counter-Strike").unwrap();
    handle.join().unwrap();

    assert_eq!(candidates.len(), 2);
    assert_eq!(candidates[0].provider_name, "SteamGridDB");
}

#[test]
fn steamgriddb_search_grids_returns_empty_when_no_matches() {
    let (base, handle) = spawn_fixture_server(&[("/search", r#"{"data":[]}"#)], 1);
    let _search = EnvGuard::set("GM_TEST_STEAMGRIDDB_SEARCH_BASE", format!("{base}/search"));
    let _grid = EnvGuard::set("GM_TEST_STEAMGRIDDB_GRID_BASE", format!("{base}/grids"));
    let client = reqwest::blocking::Client::new();
    let candidates = steamgriddb::search_grids(&client, "sgdb-key", "Missing Game").unwrap();
    handle.join().unwrap();
    assert!(candidates.is_empty());
}

#[test]
fn steamgriddb_parse_errors_and_filters_invalid_grids() {
    assert!(steamgriddb::parse_search_game_ids("{bad json").is_err());
    assert!(steamgriddb::parse_grid_candidates("{bad json").is_err());

    let client = reqwest::blocking::Client::new();
    assert!(steamgriddb::search_grids(&client, "bad\nkey", "x",).is_err());

    let filtered = steamgriddb::parse_grid_candidates(
        r#"{"data":[{"id":1,"url":"https://cdn.example.test/x.png","width":0,"height":900}]}"#,
    )
    .unwrap();
    assert!(filtered.is_empty());
}

#[test]
fn steam_search_and_metadata_round_trip_through_mock_server() {
    let (base, handle) = spawn_fixture_server(&[("/app-list", fixture("steam-app-list"))], 2);
    let _steam = EnvGuard::set("GM_TEST_STEAM_APP_LIST_URL", format!("{base}/app-list"));
    let client = reqwest::blocking::Client::new();

    let candidates = steam::search_cover_candidates(&client, "steam-key", "hades").unwrap();
    assert_eq!(candidates.len(), 2);
    assert_eq!(candidates[0].source, ArtSource::Steam);

    let metadata = steam::fetch_metadata(&client, "steam-key", "hades").unwrap();
    handle.join().unwrap();
    assert_eq!(
        metadata,
        Some(MetadataResult {
            canonical_name: "Hades".to_string(),
            source: ArtSource::Steam,
        })
    );
}

#[test]
fn steam_provider_surfaces_connect_failures() {
    let _steam = EnvGuard::set("GM_TEST_STEAM_APP_LIST_URL", "http://127.0.0.1:1/app-list");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(250))
        .build()
        .unwrap();

    assert!(steam::search_cover_candidates(&client, "steam-key", "hades").is_err());
    assert!(steam::fetch_metadata(&client, "steam-key", "hades").is_err());
}

#[test]
fn steam_provider_surfaces_response_read_failures() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buf = [0_u8; 1024];
        let _ = stream.read(&mut buf);
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 64\r\nConnection: close\r\n\r\n{\"applist\":{\"apps\":[",
            )
            .unwrap();
    });
    let _steam = EnvGuard::set(
        "GM_TEST_STEAM_APP_LIST_URL",
        format!("http://{addr}/app-list"),
    );
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(250))
        .build()
        .unwrap();

    assert!(steam::search_cover_candidates(&client, "steam-key", "hades").is_err());
    handle.join().unwrap();
}

#[test]
fn steam_fetch_metadata_returns_none_for_unknown_title() {
    let (base, handle) = spawn_fixture_server(&[("/app-list", fixture("steam-app-list"))], 1);
    let _steam = EnvGuard::set("GM_TEST_STEAM_APP_LIST_URL", format!("{base}/app-list"));
    let client = reqwest::blocking::Client::new();
    let metadata = steam::fetch_metadata(&client, "steam-key", "Totally Unknown Title").unwrap();
    handle.join().unwrap();
    assert!(metadata.is_none());
}

#[test]
fn steam_parse_app_matches_respects_limit_and_partial_matches() {
    let matches = steam::parse_app_matches(fixture("steam-app-list"), "ring", 1).unwrap();
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].name, "ELDEN RING");

    assert!(steam::parse_app_matches("{bad", "hades", 4).is_err());
}

#[test]
fn steamgriddb_search_surfaces_connect_failure_before_parsing() {
    let _search = EnvGuard::set(
        "GM_TEST_STEAMGRIDDB_SEARCH_BASE",
        "http://127.0.0.1:1/search",
    );
    let _grid = EnvGuard::set("GM_TEST_STEAMGRIDDB_GRID_BASE", "http://127.0.0.1:1/grids");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(250))
        .build()
        .unwrap();

    assert!(steamgriddb::search_grids(&client, "sgdb-key", "Hades").is_err());
}

#[test]
fn steamgriddb_grid_fetch_surfaces_connect_failure_after_search_match() {
    let (base, handle) = spawn_fixture_server(&[("/search", fixture("steamgriddb-search"))], 1);
    let _search = EnvGuard::set("GM_TEST_STEAMGRIDDB_SEARCH_BASE", format!("{base}/search"));
    let _grid = EnvGuard::set("GM_TEST_STEAMGRIDDB_GRID_BASE", "http://127.0.0.1:1/grids");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(250))
        .build()
        .unwrap();

    assert!(steamgriddb::search_grids(&client, "sgdb-key", "Counter-Strike").is_err());
    handle.join().unwrap();
}

#[test]
fn search_art_impl_merges_provider_results_when_keys_are_set() {
    let (state, _dir) = temp_state();
    set_setting_impl(&state, "steamgriddb_api_key", "sgdb-key").unwrap();
    set_setting_impl(&state, "steam_api_key", "steam-key").unwrap();

    let sgdb_candidate = game_manager_lib::domain::ArtCandidate {
        id: "sgdb-1".into(),
        image_url: "https://cdn2.steamgriddb.com/grid/1.png".into(),
        source: ArtSource::SteamGridDb,
        width: 600,
        height: 900,
        provider_name: "SteamGridDB".into(),
    };
    let steam_candidate = game_manager_lib::domain::ArtCandidate {
        id: "steam-1".into(),
        image_url: "https://cdn.akamai.steamstatic.com/steam/apps/1/library_600x900.jpg".into(),
        source: ArtSource::Steam,
        width: 600,
        height: 900,
        provider_name: "Steam".into(),
    };

    let art = search_art_with_providers(
        &state,
        "  Hades  ",
        &|_, _, _| Ok(vec![sgdb_candidate.clone()]),
        &|_, _, _| Ok(vec![steam_candidate.clone()]),
    )
    .unwrap();
    assert_eq!(art.len(), 2);
    assert_eq!(art[0].id, sgdb_candidate.id);
    assert_eq!(art[1].id, steam_candidate.id);
}

#[test]
fn search_art_impl_returns_empty_for_blank_name() {
    let (state, _dir) = temp_state();
    assert!(search_art_impl(&state, "   ").unwrap().is_empty());
}

#[test]
fn fetch_metadata_impl_uses_steam_match_and_blank_input_fallback() {
    let (state, _dir) = temp_state();
    set_setting_impl(&state, "steam_api_key", "steam-key").unwrap();

    let metadata = fetch_metadata_with_provider(&state, "Hades", &|_, _, _| {
        Ok(Some(MetadataResult {
            canonical_name: "Hades".to_string(),
            source: ArtSource::Steam,
        }))
    })
    .unwrap();
    assert_eq!(metadata.canonical_name, "Hades");
    assert_eq!(metadata.source, ArtSource::Steam);

    let blank = fetch_metadata_impl(&state, "   ").unwrap();
    assert_eq!(blank.canonical_name, "");
    assert_eq!(blank.source, ArtSource::Input);

    let fallback = fetch_metadata_with_provider(&state, "Unknown", &|_, _, _| Ok(None)).unwrap();
    assert_eq!(fallback.canonical_name, "Unknown");
    assert_eq!(fallback.source, ArtSource::Input);
}

#[test]
fn cache_art_candidate_impl_caches_allowed_local_image() {
    let (state, dir) = temp_state();
    let image_bytes = b"\x89PNG\r\n\x1a\nfakepng";
    let (url, handle) = spawn_image_server(image_bytes, "image/png");

    let cached = cache_art_candidate_impl(&state, &url).unwrap().unwrap();
    handle.join().unwrap();

    assert!(cached.contains("art-cache"));
    assert_eq!(std::fs::read(&cached).unwrap(), image_bytes);
    assert!(dir.path().join("art-cache").exists());
}

#[test]
fn cache_art_candidate_impl_rejects_empty_url() {
    let (state, _dir) = temp_state();
    assert!(cache_art_candidate_impl(&state, "   ").unwrap().is_none());
}

#[test]
fn cache_write_bytes_and_non_success_download_fail() {
    let (_state, dir) = temp_state();
    let url = "https://cdn.akamai.steamstatic.com/steam/apps/1/library_600x900.jpg";
    let path =
        cache::write_bytes(dir.path(), url, b"\x89PNG\r\n\x1a\n", Some("image/png")).unwrap();
    assert!(path.contains("art-cache"));

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request_buf = [0_u8; 1024];
        let _ = stream.read(&mut request_buf);
        stream
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .unwrap();
    });
    let client = reqwest::blocking::Client::new();
    let bad_url = format!("http://{addr}/missing.png");
    let result = cache::cache_remote_image(&client, dir.path(), &bad_url);
    handle.join().unwrap();
    assert!(result.is_err());
}

#[test]
fn search_art_impl_uses_default_provider_chain_with_mock_servers() {
    let (sgdb_base, sgdb_handle) = spawn_fixture_server(
        &[
            ("/search", fixture("steamgriddb-search")),
            ("/grids/730", fixture("steamgriddb-grids")),
        ],
        2,
    );
    let (steam_base, steam_handle) =
        spawn_fixture_server(&[("/app-list", fixture("steam-app-list"))], 2);
    let _sgdb_search = EnvGuard::set(
        "GM_TEST_STEAMGRIDDB_SEARCH_BASE",
        format!("{sgdb_base}/search"),
    );
    let _sgdb_grid = EnvGuard::set(
        "GM_TEST_STEAMGRIDDB_GRID_BASE",
        format!("{sgdb_base}/grids"),
    );
    let _steam = EnvGuard::set(
        "GM_TEST_STEAM_APP_LIST_URL",
        format!("{steam_base}/app-list"),
    );

    let (state, _dir) = temp_state();
    set_setting_impl(&state, "steamgriddb_api_key", "sgdb-key").unwrap();
    set_setting_impl(&state, "steam_api_key", "steam-key").unwrap();

    let art = search_art_impl(&state, "hades").unwrap();
    let metadata = fetch_metadata_impl(&state, "hades").unwrap();

    sgdb_handle.join().unwrap();
    steam_handle.join().unwrap();

    assert_eq!(art.len(), 4);
    assert_eq!(metadata.canonical_name, "Hades");
    assert_eq!(metadata.source, ArtSource::Steam);
}

#[test]
fn cache_rejects_oversized_payload_and_accepts_jpeg_content_type() {
    let (_state, dir) = temp_state();
    let jpeg = b"\xFF\xD8\xFFjpeg-bytes";
    let (url, handle) = spawn_image_server_with_path("/cover.jpg", jpeg, "image/jpeg");
    let client = reqwest::blocking::Client::new();
    let cached = cache::cache_remote_image(&client, dir.path(), &url).unwrap();
    handle.join().unwrap();
    assert!(cached.ends_with(".jpg"));

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let huge = vec![0x89_u8; 16 * 1024 * 1024 + 1];
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request_buf = [0_u8; 1024];
        let _ = stream.read(&mut request_buf);
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            huge.len()
        );
        stream.write_all(response.as_bytes()).unwrap();
        stream.write_all(&huge).unwrap();
    });
    let huge_url = format!("http://{addr}/huge.png");
    let result = cache::cache_remote_image(&client, dir.path(), &huge_url);
    handle.join().unwrap();
    assert!(result.is_err());
}

#[test]
fn build_cache_path_uses_content_type_when_url_has_no_extension() {
    let root = PathBuf::from("C:/cache-root");
    let webp = cache::build_cache_path(
        &root,
        "https://cdn.akamai.steamstatic.com/steam/apps/1/library",
        Some("image/webp"),
    );
    assert_eq!(webp.extension().and_then(|ext| ext.to_str()), Some("webp"));
    let jpg = cache::build_cache_path(
        &root,
        "https://cdn.akamai.steamstatic.com/steam/apps/1/library",
        Some("image/jpeg"),
    );
    assert_eq!(jpg.extension().and_then(|ext| ext.to_str()), Some("jpg"));
    let fallback = cache::build_cache_path(
        &root,
        "https://cdn.akamai.steamstatic.com/steam/apps/1/library",
        Some("image/gif"),
    );
    assert_eq!(
        fallback.extension().and_then(|ext| ext.to_str()),
        Some("img")
    );
}

#[test]
fn cache_remote_image_rejects_json_content_type_even_with_bytes() {
    let (_state, dir) = temp_state();
    let (url, handle) = spawn_image_server(b"{\"not\":\"image\"}", "application/json");
    let client = reqwest::blocking::Client::new();
    let result = cache::cache_remote_image(&client, dir.path(), &url);
    handle.join().unwrap();
    assert!(result.is_err());
}

#[test]
fn steam_parse_app_matches_prefers_exact_and_prefix_scores() {
    let exact = steam::parse_app_matches(fixture("steam-app-list"), "Hades", 4).unwrap();
    assert_eq!(exact[0].name, "Hades");

    let prefix = steam::parse_app_matches(fixture("steam-app-list"), "Hollow", 4).unwrap();
    assert_eq!(prefix[0].name, "Hollow Knight");
}

#[test]
fn search_art_impl_skips_whitespace_only_api_keys() {
    let (state, _dir) = temp_state();
    set_setting_impl(&state, "steamgriddb_api_key", "   ").unwrap();
    set_setting_impl(&state, "steam_api_key", "\t").unwrap();

    let art = search_art_impl(&state, "Hades").unwrap();
    assert!(art.is_empty());

    let messages = log_messages(&state);
    assert!(messages.contains(&"SteamGridDB art search skipped".to_string()));
    assert!(messages.contains(&"Steam metadata fallback art search skipped".to_string()));
}

#[test]
fn steamgriddb_and_steam_providers_surface_http_failures() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = thread::spawn(move || {
        for _ in 0..3 {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0_u8; 1024];
            let _ = stream.read(&mut buf);
            stream
                .write_all(
                    b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .unwrap();
        }
    });
    let base = format!("http://{addr}");
    let _search = EnvGuard::set("GM_TEST_STEAMGRIDDB_SEARCH_BASE", format!("{base}/search"));
    let _grid = EnvGuard::set("GM_TEST_STEAMGRIDDB_GRID_BASE", format!("{base}/grids"));
    let _steam = EnvGuard::set("GM_TEST_STEAM_APP_LIST_URL", format!("{base}/app-list"));
    let client = reqwest::blocking::Client::new();

    assert!(steamgriddb::search_grids(&client, "key", "x").is_err());
    assert!(steam::search_cover_candidates(&client, "key", "x").is_err());
    assert!(steam::fetch_metadata(&client, "key", "x").is_err());
    handle.join().unwrap();
}

#[test]
fn cache_art_candidate_impl_surfaces_download_failure() {
    let (state, _dir) = temp_state();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buf = [0_u8; 1024];
        let _ = stream.read(&mut buf);
        stream
            .write_all(b"HTTP/1.1 500\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .unwrap();
    });
    let url = format!("http://{addr}/cover.png");
    let result = cache_art_candidate_impl(&state, &url);
    handle.join().unwrap();
    assert!(result.is_err());

    let messages = log_messages(&state);
    assert!(messages.contains(&"Art candidate cache write failed".to_string()));
}

#[test]
fn validate_remote_art_url_allows_steam_subdomains() {
    cache::validate_remote_art_url(
        "https://cdn.akamai.steamstatic.com/steam/apps/730/library_600x900.jpg",
    )
    .unwrap();
}

#[test]
fn search_art_impl_logs_when_default_providers_fail() {
    let (state, _dir) = temp_state();
    set_setting_impl(&state, "steamgriddb_api_key", "sgdb-key").unwrap();
    set_setting_impl(&state, "steam_api_key", "steam-key").unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = thread::spawn(move || {
        for _ in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0_u8; 1024];
            let _ = stream.read(&mut buf);
            stream
                .write_all(
                    b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .unwrap();
        }
    });
    let base = format!("http://{addr}");
    let _search = EnvGuard::set("GM_TEST_STEAMGRIDDB_SEARCH_BASE", format!("{base}/search"));
    let _grid = EnvGuard::set("GM_TEST_STEAMGRIDDB_GRID_BASE", format!("{base}/grids"));
    let _steam = EnvGuard::set("GM_TEST_STEAM_APP_LIST_URL", format!("{base}/app-list"));

    let art = search_art_impl(&state, "Hades").unwrap();
    handle.join().unwrap();
    assert!(art.is_empty());

    let messages = log_messages(&state);
    assert!(messages.contains(&"SteamGridDB art search failed".to_string()));
    assert!(messages.contains(&"Steam metadata fallback art search failed".to_string()));
}

#[test]
fn fetch_metadata_impl_logs_when_default_provider_fails() {
    let (state, _dir) = temp_state();
    set_setting_impl(&state, "steam_api_key", "steam-key").unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buf = [0_u8; 1024];
        let _ = stream.read(&mut buf);
        stream
            .write_all(
                b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )
            .unwrap();
    });
    let _steam = EnvGuard::set(
        "GM_TEST_STEAM_APP_LIST_URL",
        format!("http://{addr}/app-list"),
    );

    let metadata = fetch_metadata_impl(&state, "Hades").unwrap();
    handle.join().unwrap();
    assert_eq!(metadata.canonical_name, "Hades");
    assert_eq!(metadata.source, ArtSource::Input);

    let messages = log_messages(&state);
    assert!(messages.contains(&"Steam metadata lookup failed".to_string()));
}

#[test]
fn search_art_with_providers_logs_missing_api_keys() {
    let (state, _dir) = temp_state();
    let art = search_art_with_providers(&state, "Hades", &|_, _, _| Ok(vec![]), &|_, _, _| {
        Ok(vec![])
    })
    .unwrap();
    assert!(art.is_empty());

    let messages = log_messages(&state);
    assert!(messages.contains(&"SteamGridDB art search skipped".to_string()));
    assert!(messages.contains(&"Steam metadata fallback art search skipped".to_string()));
}

#[test]
fn search_art_with_providers_returns_empty_for_blank_name() {
    let (state, _dir) = temp_state();
    let art = search_art_with_providers(
        &state,
        "   ",
        &|_, _, _| panic!("providers must not run for blank input"),
        &|_, _, _| panic!("providers must not run for blank input"),
    )
    .unwrap();
    assert!(art.is_empty());
}

#[test]
fn validate_remote_art_url_allows_exact_provider_suffix_hosts() {
    cache::validate_remote_art_url("https://steamstatic.com/grid.png").unwrap();
    cache::validate_remote_art_url("https://steamgriddb.com/grid.png").unwrap();
}

#[test]
fn steam_parse_app_matches_uses_contains_scoring() {
    let matches = steam::parse_app_matches(fixture("steam-app-list"), "knight", 4).unwrap();
    assert!(matches.iter().any(|entry| entry.name == "Hollow Knight"));
}

#[test]
fn cache_remote_image_accepts_known_image_content_types() {
    let (_state, dir) = temp_state();
    let (url, handle) = spawn_image_server(b"not-png-bytes", "image/png");
    let client = reqwest::blocking::Client::new();
    let cached_path = cache::cache_remote_image(&client, dir.path(), &url).unwrap();
    handle.join().unwrap();
    assert!(cached_path.ends_with(".png"));
}

#[test]
fn validate_remote_art_url_rejects_missing_host() {
    assert!(cache::validate_remote_art_url("https:///cover.png").is_err());
}

#[test]
fn steam_parse_app_matches_skips_empty_names() {
    let payload = r#"{"applist":{"apps":[{"appid":1,"name":""},{"appid":2,"name":"Hades"}]}}"#;
    let matches = steam::parse_app_matches(payload, "hades", 4).unwrap();
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].name, "Hades");
}

#[test]
fn cache_remote_image_accepts_localhost_host() {
    let (_state, dir) = temp_state();
    let image_bytes = b"\x89PNG\r\n\x1a\nfakepng";
    let (url, handle) = spawn_image_server(image_bytes, "image/png");
    let localhost_url = url.replace("127.0.0.1", "localhost");
    let client = reqwest::blocking::Client::new();
    let cached_path = cache::cache_remote_image(&client, dir.path(), &localhost_url).unwrap();
    handle.join().unwrap();
    assert!(cached_path.contains("art-cache"));
}

#[test]
fn fetch_metadata_with_provider_logs_missing_steam_key() {
    let (state, _dir) = temp_state();
    let metadata = fetch_metadata_with_provider(&state, "Hades", &|_, _, _| {
        panic!("provider must not run when steam key is missing")
    })
    .unwrap();
    assert_eq!(metadata.canonical_name, "Hades");
    assert_eq!(metadata.source, ArtSource::Input);

    let messages = log_messages(&state);
    assert!(messages.contains(&"Steam metadata lookup skipped".to_string()));
}
