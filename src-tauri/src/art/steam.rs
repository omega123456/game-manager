//! Steam metadata fallback based on the public app list + predictable portrait
//! library art. Steam's `library_600x900` asset matches the 3:4 cover candidates
//! the wizard expects (the same 600x900 dimension SteamGridDB grids use), so the
//! fallback never surfaces non-portrait assets into the cover-selection flow.

use reqwest::blocking::Client;
use serde::Deserialize;

use crate::domain::{ArtCandidate, ArtSource, MetadataResult};
use crate::error::{AppError, AppResult};

const APP_LIST_URL: &str = "https://api.steampowered.com/ISteamApps/GetAppList/v2/";
const LIBRARY_BASE_URL: &str = "https://cdn.akamai.steamstatic.com/steam/apps";
const COVER_WIDTH: i64 = 600;
const COVER_HEIGHT: i64 = 900;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SteamAppMatch {
    pub app_id: i64,
    pub name: String,
}

#[derive(Debug, Deserialize)]
struct AppListEnvelope {
    applist: AppList,
}

#[derive(Debug, Deserialize)]
struct AppList {
    apps: Vec<SteamApp>,
}

#[derive(Debug, Deserialize)]
struct SteamApp {
    appid: i64,
    name: String,
}

fn normalized(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn score_match(query: &str, candidate: &str) -> Option<(i32, usize)> {
    let query = normalized(query);
    let candidate = normalized(candidate);
    if candidate.is_empty() {
        return None;
    }
    if candidate == query {
        return Some((0, candidate.len()));
    }
    if candidate.starts_with(&query) {
        return Some((1, candidate.len()));
    }
    if candidate.contains(&query) {
        return Some((2, candidate.len()));
    }
    None
}

/// Parse and rank Steam app-list results for a search term.
pub fn parse_app_matches(payload: &str, name: &str, limit: usize) -> AppResult<Vec<SteamAppMatch>> {
    let envelope: AppListEnvelope = serde_json::from_str(payload)
        .map_err(|err| AppError::other(format!("parse Steam app list payload: {err}")))?;
    let mut matches: Vec<(i32, usize, SteamAppMatch)> = envelope
        .applist
        .apps
        .into_iter()
        .filter_map(|app| {
            score_match(name, &app.name).map(|(score, len)| {
                (
                    score,
                    len,
                    SteamAppMatch {
                        app_id: app.appid,
                        name: app.name,
                    },
                )
            })
        })
        .collect();
    matches.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then(a.1.cmp(&b.1))
            .then(a.2.name.cmp(&b.2.name))
    });
    Ok(matches
        .into_iter()
        .take(limit)
        .map(|(_, _, app)| app)
        .collect())
}

/// Convert matched Steam apps into deterministic 3:4 portrait cover candidates.
pub fn cover_candidates(matches: &[SteamAppMatch]) -> Vec<ArtCandidate> {
    matches
        .iter()
        .map(|app| ArtCandidate {
            id: format!("steam-{}", app.app_id),
            image_url: format!("{LIBRARY_BASE_URL}/{}/library_600x900.jpg", app.app_id),
            source: ArtSource::Steam,
            width: COVER_WIDTH,
            height: COVER_HEIGHT,
            provider_name: "Steam".to_string(),
        })
        .collect()
}

/// Search Steam app metadata and synthesize 3:4 portrait fallback candidates.
pub fn search_cover_candidates(
    client: &Client,
    api_key: &str,
    name: &str,
) -> AppResult<Vec<ArtCandidate>> {
    let payload = client
        .get(APP_LIST_URL)
        .query(&[("key", api_key.trim())])
        .send()
        .map_err(|err| AppError::other(format!("Steam app list request failed: {err}")))?
        .error_for_status()
        .map_err(|err| AppError::other(format!("Steam app list failed: {err}")))?
        .text()
        .map_err(|err| AppError::other(format!("Steam app list response read failed: {err}")))?;
    let matches = parse_app_matches(&payload, name, 4)?;
    Ok(cover_candidates(&matches))
}

/// Resolve the best canonical Steam app name for metadata autofill.
pub fn fetch_metadata(
    client: &Client,
    api_key: &str,
    name: &str,
) -> AppResult<Option<MetadataResult>> {
    let payload = client
        .get(APP_LIST_URL)
        .query(&[("key", api_key.trim())])
        .send()
        .map_err(|err| AppError::other(format!("Steam metadata request failed: {err}")))?
        .error_for_status()
        .map_err(|err| AppError::other(format!("Steam metadata lookup failed: {err}")))?
        .text()
        .map_err(|err| AppError::other(format!("Steam metadata response read failed: {err}")))?;
    let matches = parse_app_matches(&payload, name, 1)?;
    Ok(matches.into_iter().next().map(|app| MetadataResult {
        canonical_name: app.name,
        source: ArtSource::Steam,
    }))
}
