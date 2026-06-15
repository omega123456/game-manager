import { describe, expect, it } from 'vitest'

import { formatLastPlayed, getLibraryMeta } from '@/features/games/library-format'

describe('formatLastPlayed', () => {
  it('returns a friendly label when the game has never launched', () => {
    expect(formatLastPlayed()).toBe('Never launched')
    expect(formatLastPlayed(undefined)).toBe('Never launched')
  })

  it('returns a friendly label for invalid timestamps', () => {
    expect(formatLastPlayed('not-a-date')).toBe('Never launched')
  })

  it('formats valid timestamps for library cards', () => {
    expect(formatLastPlayed('2026-06-14T12:00:00Z')).toBe('14 Jun 2026')
  })
})

describe('getLibraryMeta', () => {
  it('combines playtime and last-played labels', () => {
    expect(getLibraryMeta(3600, '2026-06-14T12:00:00Z')).toEqual({
      playtime: '1.0 hrs',
      lastPlayed: '14 Jun 2026',
    })
  })
})
