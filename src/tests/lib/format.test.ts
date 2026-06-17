import { describe, expect, it } from 'vitest'

import { clamp, formatPlaytime } from '../../lib/format'

describe('formatPlaytime', () => {
  it('returns "Never played" for zero/invalid input', () => {
    expect(formatPlaytime(0)).toBe('Never played')
    expect(formatPlaytime(-5)).toBe('Never played')
    expect(formatPlaytime(Number.NaN)).toBe('Never played')
  })

  it('formats hours with one decimal', () => {
    expect(formatPlaytime(3600)).toBe('1.0 hrs')
    expect(formatPlaytime(5400)).toBe('1.5 hrs')
  })

  it('formats sub-hour durations in minutes', () => {
    expect(formatPlaytime(1800)).toBe('30 min')
  })
})

describe('clamp', () => {
  it('clamps to the inclusive range', () => {
    expect(clamp(5, 1, 10)).toBe(5)
    expect(clamp(-3, 1, 10)).toBe(1)
    expect(clamp(99, 1, 10)).toBe(10)
  })
})
