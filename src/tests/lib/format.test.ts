import { describe, expect, it } from 'vitest'

import { clamp, formatPlaytime } from '../../lib/format'

describe('formatPlaytime', () => {
  it('returns "never played" for zero/invalid input', () => {
    expect(formatPlaytime(0)).toBe('never played')
    expect(formatPlaytime(-5)).toBe('never played')
    expect(formatPlaytime(Number.NaN)).toBe('never played')
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
