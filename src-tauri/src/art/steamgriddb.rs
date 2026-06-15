//! SteamGridDB search-by-name integration for 3:4 portrait grids.

use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderValue};
use serde::Deserialize;

use crate::domain::{ArtCandidate, ArtSource};
use crate::error::{AppError, AppResult};

const SEARCH_BASE_URL: &str = "https://www.steamgriddb.com/api/v2/search/autocomplete";
const GRID_BASE_URL: &str = "https://www.steamgriddb.com/api/v2/grids/game";

#[derive(Debug, Deserialize)]
struct SearchEnvelope {
    data: Vec<SearchMatch>,
}

#[derive(Debug, Deserialize)]
struct SearchMatch {
    id: i64,
}

#[derive(Debug, Deserialize)]
struct GridEnvelope {
    data: Vec<GridAsset>,
}

#[derive(Debug, Deserialize)]
struct GridAsset {
    id: i64,
    url: String,
    width: i64,
    height: i64,
}

fn grid_headers(api_key: &str) -> AppResult<HeaderMap> {
    let mut headers = HeaderMap::new();
    let bearer = format!("Bearer {}", api_key.trim());
    let value = HeaderValue::from_str(&bearer)
        .map_err(|err| AppError::other(format!("invalid SteamGridDB API key header: {err}")))?;
    headers.insert("Authorization", value);
    Ok(headers)
}

/// Parse an autocomplete payload into the ordered candidate game ids.
pub fn parse_search_game_ids(payload: &str) -> AppResult<Vec<i64>> {
    let envelope: SearchEnvelope = serde_json::from_str(payload)
        .map_err(|err| AppError::other(format!("parse SteamGridDB search payload: {err}")))?;
    Ok(envelope.data.into_iter().map(|entry| entry.id).collect())
}

/// Parse a grids payload into portrait cover-art candidates.
pub fn parse_grid_candidates(payload: &str) -> AppResult<Vec<ArtCandidate>> {
    let envelope: GridEnvelope = serde_json::from_str(payload)
        .map_err(|err| AppError::other(format!("parse SteamGridDB grids payload: {err}")))?;
    Ok(envelope
        .data
        .into_iter()
        .filter(|grid| grid.width > 0 && grid.height > 0)
        .map(|grid| ArtCandidate {
            id: format!("sgdb-{}", grid.id),
            image_url: grid.url,
            source: ArtSource::SteamGridDb,
            width: grid.width,
            height: grid.height,
            provider_name: "SteamGridDB".to_string(),
        })
        .collect())
}

/// Search SteamGridDB for portrait grid art matching the provided name.
pub fn search_grids(client: &Client, api_key: &str, name: &str) -> AppResult<Vec<ArtCandidate>> {
    let headers = grid_headers(api_key)?;
    let encoded_name = urlencoding::encode(name.trim());
    let search_payload = client
        .get(format!("{SEARCH_BASE_URL}/{encoded_name}"))
        .headers(headers.clone())
        .send()
        .map_err(|err| AppError::other(format!("SteamGridDB search request failed: {err}")))?
        .error_for_status()
        .map_err(|err| AppError::other(format!("SteamGridDB search failed: {err}")))?
        .text()
        .map_err(|err| {
            AppError::other(format!("SteamGridDB search response read failed: {err}"))
        })?;

    let game_ids = parse_search_game_ids(&search_payload)?;
    let Some(game_id) = game_ids.first() else {
        return Ok(Vec::new());
    };

    let grid_payload = client
        .get(format!("{GRID_BASE_URL}/{game_id}"))
        .headers(headers)
        .query(&[("dimensions", "600x900"), ("types", "static")])
        .send()
        .map_err(|err| AppError::other(format!("SteamGridDB grids request failed: {err}")))?
        .error_for_status()
        .map_err(|err| AppError::other(format!("SteamGridDB grids failed: {err}")))?
        .text()
        .map_err(|err| AppError::other(format!("SteamGridDB grids response read failed: {err}")))?;

    parse_grid_candidates(&grid_payload)
}
