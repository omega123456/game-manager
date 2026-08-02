import { invoke } from '@tauri-apps/api/core'

import type { ArtCandidate, MetadataResult } from '@/types/domain'

/** Search remote providers for cover-art candidates matching a game name. */
export function searchArt(name: string): Promise<ArtCandidate[]> {
  return invoke<ArtCandidate[]>('search_art', { name })
}

/** Fetch the best canonical metadata name for a game title search. */
export function fetchMetadata(name: string): Promise<MetadataResult> {
  return invoke<MetadataResult>('fetch_metadata', { name })
}

/** Cache a selected remote art candidate into the local app-data image cache. */
export function cacheArtCandidate(url: string): Promise<string | null> {
  return invoke<string | null>('cache_art_candidate', { url })
}

/**
 * Copy a user-picked local cover image into the app-data art cache.
 *
 * The picked path itself is only loadable by the webview for the current
 * session, so the cached copy is what gets stored on the game.
 */
export function importLocalArt(path: string): Promise<string | null> {
  return invoke<string | null>('import_local_art', { path })
}
