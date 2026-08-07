import { afterEach, describe, expect, it, vi } from 'vitest'

import { clamp, formatPlaytime } from '../../lib/format'

describe('formatPlaytime', () => {
  it('returns "Never played" for zero/invalid input', () => {
    expect(formatPlaytime(0)).toBe('Never played')
    expect(formatPlaytime(-5)).toBe('Never played')
    expect(formatPlaytime(Number.NaN)).toBe('Never played')
  })

  it('formats whole hours without a minutes part', () => {
    expect(formatPlaytime(3600)).toBe('1 hr')
    expect(formatPlaytime(7200)).toBe('2 hrs')
  })

  it('formats hours and minutes', () => {
    expect(formatPlaytime(5400)).toBe('1 hr, 30 mins')
    expect(formatPlaytime(33_300)).toBe('9 hrs, 15 mins')
  })

  it('formats sub-hour durations in minutes', () => {
    expect(formatPlaytime(1800)).toBe('30 mins')
    expect(formatPlaytime(60)).toBe('1 min')
  })

  it('formats sub-minute durations as a floor label', () => {
    expect(formatPlaytime(30)).toBe('<1 min')
  })

  it('drops the minutes component at and above the 100 hour cutoff', () => {
    expect(formatPlaytime(99 * 3600 + 1800)).toBe('99 hrs, 30 mins')
    expect(formatPlaytime(100 * 3600 + 1800)).toBe('100 hrs')
  })

  it('groups thousands in the hours component', () => {
    expect(formatPlaytime(1247 * 3600 + 1800)).toBe('1,247 hrs')
  })
})

describe('formatPlaytime without Intl.DurationFormat', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  /**
   * Reload the module against an `Intl` that lacks `DurationFormat`, as on
   * Chromium < 129. Intl's own properties are non-enumerable, so the stub is
   * rebuilt explicitly rather than spread.
   */
  async function loadWithoutDurationFormat() {
    vi.stubGlobal('Intl', {
      NumberFormat: Intl.NumberFormat,
      DateTimeFormat: Intl.DateTimeFormat,
    })
    vi.resetModules()
    return import('../../lib/format')
  }

  it('falls back to manual assembly for hours and minutes', async () => {
    const { formatPlaytime: fallback } = await loadWithoutDurationFormat()

    expect(fallback(33_300)).toBe('9 hrs, 15 mins')
    expect(fallback(3600)).toBe('1 hr')
    expect(fallback(1247 * 3600)).toBe('1,247 hrs')
  })

  it('falls back to manual assembly for sub-hour durations', async () => {
    const { formatPlaytime: fallback } = await loadWithoutDurationFormat()

    expect(fallback(1800)).toBe('30 mins')
    expect(fallback(60)).toBe('1 min')
  })
})

describe('clamp', () => {
  it('clamps to the inclusive range', () => {
    expect(clamp(5, 1, 10)).toBe(5)
    expect(clamp(-3, 1, 10)).toBe(1)
    expect(clamp(99, 1, 10)).toBe(10)
  })
})
