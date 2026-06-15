//! Art + metadata commands used by the future Add Game wizard.

use std::path::Path;

use reqwest::blocking::Client;

use crate::art::{cache, steam, steamgriddb};
use crate::db::repo::settings;
use crate::domain::{ArtCandidate, ArtSource, LogLevel, MetadataResult};
use crate::error::AppResult;
use crate::logging::write_log;
use crate::state::AppState;

const ART_CATEGORY: &str = "art";
const STEAMGRIDDB_KEY: &str = "steamgriddb_api_key";
const STEAM_KEY: &str = "steam_api_key";

type SearchProvider = dyn Fn(&Client, &str, &str) -> AppResult<Vec<ArtCandidate>>;
type MetadataProvider = dyn Fn(&Client, &str, &str) -> AppResult<Option<MetadataResult>>;
type CacheProvider = dyn Fn(&Client, &Path, &str) -> AppResult<String>;

struct ArtDeps<'a> {
    steamgriddb_search: &'a SearchProvider,
    steam_search: &'a SearchProvider,
    steam_metadata: &'a MetadataProvider,
    cache_remote: &'a CacheProvider,
}

fn default_client() -> AppResult<Client> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|err| crate::error::AppError::other(format!("build art HTTP client: {err}")))
}

fn default_deps() -> ArtDeps<'static> {
    ArtDeps {
        steamgriddb_search: &steamgriddb::search_grids,
        steam_search: &steam::search_cover_candidates,
        steam_metadata: &steam::fetch_metadata,
        cache_remote: &cache::cache_remote_image,
    }
}

fn read_setting(state: &AppState, key: &str) -> AppResult<Option<String>> {
    state.with_db(|conn| settings::get(conn, key))
}

fn log_art(state: &AppState, level: LogLevel, message: &str, details: &str) {
    let _ = state.with_db(|conn| {
        write_log(
            conn,
            level,
            ART_CATEGORY,
            message,
            None,
            None,
            Some(details),
        )
    });
}

fn trimmed_name(name: &str) -> String {
    name.trim().to_string()
}

fn search_art_with_deps(
    state: &AppState,
    name: &str,
    deps: ArtDeps<'_>,
) -> AppResult<Vec<ArtCandidate>> {
    let name = trimmed_name(name);
    if name.is_empty() {
        return Ok(Vec::new());
    }

    let client = default_client()?;
    let mut results = Vec::new();

    match read_setting(state, STEAMGRIDDB_KEY)? {
        Some(key) if !key.trim().is_empty() => {
            match (deps.steamgriddb_search)(&client, &key, &name) {
                Ok(mut candidates) => results.append(&mut candidates),
                Err(err) => log_art(
                    state,
                    LogLevel::Warn,
                    "SteamGridDB art search failed",
                    &err.to_string(),
                ),
            }
        }
        _ => log_art(
            state,
            LogLevel::Info,
            "SteamGridDB art search skipped",
            "steamgriddb_api_key is missing",
        ),
    }

    match read_setting(state, STEAM_KEY)? {
        Some(key) if !key.trim().is_empty() => match (deps.steam_search)(&client, &key, &name) {
            Ok(mut candidates) => results.append(&mut candidates),
            Err(err) => log_art(
                state,
                LogLevel::Warn,
                "Steam metadata fallback art search failed",
                &err.to_string(),
            ),
        },
        _ => log_art(
            state,
            LogLevel::Info,
            "Steam metadata fallback art search skipped",
            "steam_api_key is missing",
        ),
    }

    Ok(results)
}

/// Testable/provider-injected variant of [`search_art_impl`].
pub fn search_art_with_providers<'a, F1, F2>(
    state: &AppState,
    name: &str,
    steamgriddb_search: &'a F1,
    steam_search: &'a F2,
) -> AppResult<Vec<ArtCandidate>>
where
    F1: Fn(&Client, &str, &str) -> AppResult<Vec<ArtCandidate>>,
    F2: Fn(&Client, &str, &str) -> AppResult<Vec<ArtCandidate>>,
{
    let name = trimmed_name(name);
    if name.is_empty() {
        return Ok(Vec::new());
    }

    let client = default_client()?;
    let mut results = Vec::new();

    match read_setting(state, STEAMGRIDDB_KEY)? {
        Some(key) if !key.trim().is_empty() => match steamgriddb_search(&client, &key, &name) {
            Ok(mut candidates) => results.append(&mut candidates),
            Err(err) => log_art(
                state,
                LogLevel::Warn,
                "SteamGridDB art search failed",
                &err.to_string(),
            ),
        },
        _ => log_art(
            state,
            LogLevel::Info,
            "SteamGridDB art search skipped",
            "steamgriddb_api_key is missing",
        ),
    }

    match read_setting(state, STEAM_KEY)? {
        Some(key) if !key.trim().is_empty() => match steam_search(&client, &key, &name) {
            Ok(mut candidates) => results.append(&mut candidates),
            Err(err) => log_art(
                state,
                LogLevel::Warn,
                "Steam metadata fallback art search failed",
                &err.to_string(),
            ),
        },
        _ => log_art(
            state,
            LogLevel::Info,
            "Steam metadata fallback art search skipped",
            "steam_api_key is missing",
        ),
    }

    Ok(results)
}

fn fetch_metadata_with_deps(
    state: &AppState,
    name: &str,
    deps: ArtDeps<'_>,
) -> AppResult<MetadataResult> {
    let name = trimmed_name(name);
    if name.is_empty() {
        return Ok(MetadataResult {
            canonical_name: String::new(),
            source: ArtSource::Input,
        });
    }

    let fallback = MetadataResult {
        canonical_name: name.clone(),
        source: ArtSource::Input,
    };

    match read_setting(state, STEAM_KEY)? {
        Some(key) if !key.trim().is_empty() => {
            let client = default_client()?;
            match (deps.steam_metadata)(&client, &key, &name) {
                Ok(Some(metadata)) => Ok(metadata),
                Ok(None) => Ok(fallback),
                Err(err) => {
                    log_art(
                        state,
                        LogLevel::Warn,
                        "Steam metadata lookup failed",
                        &err.to_string(),
                    );
                    Ok(fallback)
                }
            }
        }
        _ => {
            log_art(
                state,
                LogLevel::Info,
                "Steam metadata lookup skipped",
                "steam_api_key is missing",
            );
            Ok(fallback)
        }
    }
}

/// Testable/provider-injected variant of [`fetch_metadata_impl`].
pub fn fetch_metadata_with_provider<'a, F>(
    state: &AppState,
    name: &str,
    steam_metadata: &'a F,
) -> AppResult<MetadataResult>
where
    F: Fn(&Client, &str, &str) -> AppResult<Option<MetadataResult>>,
{
    let name = trimmed_name(name);
    if name.is_empty() {
        return Ok(MetadataResult {
            canonical_name: String::new(),
            source: ArtSource::Input,
        });
    }

    let fallback = MetadataResult {
        canonical_name: name.clone(),
        source: ArtSource::Input,
    };

    match read_setting(state, STEAM_KEY)? {
        Some(key) if !key.trim().is_empty() => {
            let client = default_client()?;
            match steam_metadata(&client, &key, &name) {
                Ok(Some(metadata)) => Ok(metadata),
                Ok(None) => Ok(fallback),
                Err(err) => {
                    log_art(
                        state,
                        LogLevel::Warn,
                        "Steam metadata lookup failed",
                        &err.to_string(),
                    );
                    Ok(fallback)
                }
            }
        }
        _ => {
            log_art(
                state,
                LogLevel::Info,
                "Steam metadata lookup skipped",
                "steam_api_key is missing",
            );
            Ok(fallback)
        }
    }
}

fn cache_art_candidate_with_deps(
    state: &AppState,
    url: &str,
    deps: ArtDeps<'_>,
) -> AppResult<Option<String>> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if let Err(err) = cache::validate_remote_art_url(trimmed) {
        log_art(
            state,
            LogLevel::Warn,
            "Art candidate cache rejected unsafe url",
            &err.to_string(),
        );
        return Err(err);
    }

    let client = default_client()?;
    match (deps.cache_remote)(&client, state.app_data_dir(), trimmed) {
        Ok(path) => Ok(Some(path)),
        Err(err) => {
            log_art(
                state,
                LogLevel::Warn,
                "Art candidate cache write failed",
                &err.to_string(),
            );
            // Surface the failure rather than masking it as a successful no-op:
            // the wizard must block progression so a selected candidate never
            // saves a game with a null image_path.
            Err(err)
        }
    }
}

/// Search remote art providers for cover candidates.
pub fn search_art_impl(state: &AppState, name: &str) -> AppResult<Vec<ArtCandidate>> {
    search_art_with_deps(state, name, default_deps())
}

/// Fetch the best canonical name available for metadata autofill.
pub fn fetch_metadata_impl(state: &AppState, name: &str) -> AppResult<MetadataResult> {
    fetch_metadata_with_deps(state, name, default_deps())
}

/// Persist a selected remote art candidate into the local image cache.
pub fn cache_art_candidate_impl(state: &AppState, url: &str) -> AppResult<Option<String>> {
    cache_art_candidate_with_deps(state, url, default_deps())
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn search_art(state: tauri::State<'_, AppState>, name: String) -> AppResult<Vec<ArtCandidate>> {
    search_art_impl(&state, &name)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn fetch_metadata(
    state: tauri::State<'_, AppState>,
    name: String,
) -> AppResult<MetadataResult> {
    fetch_metadata_impl(&state, &name)
}

#[cfg(not(coverage))]
#[tauri::command]
pub fn cache_art_candidate(
    state: tauri::State<'_, AppState>,
    url: String,
) -> AppResult<Option<String>> {
    cache_art_candidate_impl(&state, &url)
}
