import type { ArtCandidate, MetadataResult } from '@/types/domain'

import type { PlaywrightFixtureHandler } from './index'

export const ART_CANDIDATES: ArtCandidate[] = [
  {
    id: 'sgdb-100',
    imageUrl: 'https://cdn.example.test/sgdb/alan-wake-2-cover.png',
    source: 'steamGridDb',
    width: 600,
    height: 900,
    providerName: 'SteamGridDB',
  },
  {
    id: 'sgdb-101',
    imageUrl: 'https://cdn.example.test/sgdb/alan-wake-2-cover-alt-1.png',
    source: 'steamGridDb',
    width: 600,
    height: 900,
    providerName: 'SteamGridDB',
  },
  {
    id: 'sgdb-102',
    imageUrl: 'https://cdn.example.test/sgdb/alan-wake-2-cover-alt-2.png',
    source: 'steamGridDb',
    width: 600,
    height: 900,
    providerName: 'SteamGridDB',
  },
  {
    id: 'steam-200',
    imageUrl: 'https://cdn.example.test/steam/alan-wake-2-cover.png',
    source: 'steam',
    width: 600,
    height: 900,
    providerName: 'Steam',
  },
]

export const METADATA_RESULT: MetadataResult = {
  canonicalName: 'Alan Wake 2',
  source: 'steam',
}

export const artFixtures: Record<string, PlaywrightFixtureHandler> = {
  search_art: () => ART_CANDIDATES,
  fetch_metadata: () => METADATA_RESULT,
  cache_art_candidate: () => 'C:/Users/Test/AppData/Roaming/game-manager/art-cache/alan-wake-2.png',
}
