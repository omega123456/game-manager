import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  parseAccentKey,
  parseThemePreference,
  readStoredAccent,
  readStoredTheme,
  writeStoredAccent,
  writeStoredTheme,
} from '@/lib/theme-storage'

describe('theme-storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to system theme and default accent when unset', () => {
    expect(readStoredTheme()).toBe('system')
    expect(readStoredAccent()).toBe('default')
  })

  it('round-trips theme and accent through storage', () => {
    writeStoredTheme('dark')
    writeStoredAccent('emerald')
    expect(readStoredTheme()).toBe('dark')
    expect(readStoredAccent()).toBe('emerald')
  })

  it('ignores invalid stored values', () => {
    localStorage.setItem('gm.theme', 'neon')
    localStorage.setItem('gm.accent', 'chartreuse')
    expect(readStoredTheme()).toBe('system')
    expect(readStoredAccent()).toBe('default')
  })

  it('parses valid theme/accent values and rejects invalid ones', () => {
    expect(parseThemePreference('dark')).toBe('dark')
    expect(parseThemePreference('neon')).toBeNull()
    expect(parseThemePreference(null)).toBeNull()
    expect(parseThemePreference(undefined)).toBeNull()
    expect(parseAccentKey('emerald')).toBe('emerald')
    expect(parseAccentKey('chartreuse')).toBeNull()
    expect(parseAccentKey(null)).toBeNull()
  })

  it('falls back when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })

    expect(readStoredTheme()).toBe('system')
    expect(readStoredAccent()).toBe('default')
    expect(() => writeStoredTheme('dark')).not.toThrow()
    expect(() => writeStoredAccent('emerald')).not.toThrow()

    vi.unstubAllGlobals()
  })
})
