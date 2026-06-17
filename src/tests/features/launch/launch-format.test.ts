import { describe, expect, it } from 'vitest'

import { formatElapsed, formatLoggedPlaytime, phaseLabel } from '@/features/launch/launch-format'

describe('formatElapsed', () => {
  it('formats sub-hour durations as mm:ss', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(9)).toBe('00:09')
    expect(formatElapsed(75)).toBe('01:15')
  })

  it('formats hour-plus durations as h:mm:ss', () => {
    expect(formatElapsed(3661)).toBe('1:01:01')
  })

  it('clamps invalid or negative input to zero', () => {
    expect(formatElapsed(-5)).toBe('00:00')
    expect(formatElapsed(Number.NaN)).toBe('00:00')
  })
})

describe('formatLoggedPlaytime', () => {
  it('renders hours and minutes', () => {
    expect(formatLoggedPlaytime(8040)).toBe('2h 14m')
  })

  it('renders minutes only when under an hour', () => {
    expect(formatLoggedPlaytime(180)).toBe('3m')
  })

  it('renders seconds for very short sessions', () => {
    expect(formatLoggedPlaytime(42)).toBe('42s')
    expect(formatLoggedPlaytime(0)).toBe('0s')
  })
})

describe('phaseLabel', () => {
  it('maps each phase to a label', () => {
    expect(phaseLabel('before')).toBe('Preparing')
    expect(phaseLabel('waitingForProcess')).toBe('Launching')
    expect(phaseLabel('playing')).toBe('Playing')
    expect(phaseLabel('onExit')).toBe('Cleaning up')
    expect(phaseLabel('ended')).toBe('Session ended')
  })
})
