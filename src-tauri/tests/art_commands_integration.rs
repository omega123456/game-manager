//! Art command + provider integration tests for Phase B3.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::thread;

use game_manager_lib::art::{cache, steam, steamgriddb};
use game_manager_lib::commands::art::{
    cache_art_candidate_impl, fetch_metadata_impl, fetch_metadata_with_provider, search_art_impl,
    search_art_with_providers,
};
use game_manager_lib::commands::settings::set_setting_impl;
use game_manager_lib::db::repo::logs;
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
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
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
    });
    (format!("http://{addr}/cover.png"), handle)
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
