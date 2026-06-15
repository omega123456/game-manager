import { describe, expect, it } from 'vitest'

import { cacheArtCandidate, fetchMetadata, searchArt } from '@/lib/ipc/art-commands'
import { ipc } from '../ipc-mock'

describe('art-commands', () => {
  it('searchArt forwards the name and returns candidates', async () => {
    ipc.override('search_art', (args) => [
      {
        id: 'sgdb-1',
        imageUrl: `https://example.test/${String(args?.name).toLowerCase()}.png`,
        source: 'steamGridDb',
        width: 600,
        height: 900,
        providerName: 'SteamGridDB',
      },
    ])

    await expect(searchArt('Hades II')).resolves.toEqual([
      {
        id: 'sgdb-1',
        imageUrl: 'https://example.test/hades ii.png',
        source: 'steamGridDb',
        width: 600,
        height: 900,
        providerName: 'SteamGridDB',
      },
    ])
    expect(ipc.calls('search_art')).toEqual([{ name: 'Hades II' }])
  })

  it('fetchMetadata returns the backend response', async () => {
    ipc.override('fetch_metadata', () => ({
      canonicalName: 'Control Ultimate Edition',
      source: 'steam',
    }))

    await expect(fetchMetadata('control')).resolves.toEqual({
      canonicalName: 'Control Ultimate Edition',
      source: 'steam',
    })
  })

  it('cacheArtCandidate resolves to a local image path or null', async () => {
    ipc.override('cache_art_candidate', () => 'C:/cache/control.png')
    await expect(cacheArtCandidate('https://cdn.example.test/control.png')).resolves.toBe(
      'C:/cache/control.png'
    )

    ipc.override('cache_art_candidate', () => null)
    await expect(cacheArtCandidate('https://cdn.example.test/missing.png')).resolves.toBeNull()
  })
})
