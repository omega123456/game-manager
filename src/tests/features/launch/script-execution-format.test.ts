import { describe, expect, it } from 'vitest'

import {
  SCRIPT_EXECUTION_PHASE_ORDER,
  formatDuration,
  phaseMeta,
  scriptRecordTiming,
} from '@/features/launch/script-execution-format'
import type { LaunchScriptRecord } from '@/types/domain'

function record(overrides: Partial<LaunchScriptRecord>): LaunchScriptRecord {
  return {
    id: 1,
    launchRunId: 41,
    scriptId: 11,
    name: 'Script',
    phase: 'before',
    provenance: 'direct',
    order: 1,
    priority: 5,
    requiredUtilityNames: [],
    status: 'pending',
    ...overrides,
  }
}

describe('formatDuration', () => {
  it('clamps non-positive and non-finite inputs to 0.0s', () => {
    expect(formatDuration(0)).toBe('0.0s')
    expect(formatDuration(-500)).toBe('0.0s')
    expect(formatDuration(Number.NaN)).toBe('0.0s')
  })

  it('renders sub-10s durations with one decimal', () => {
    expect(formatDuration(400)).toBe('0.4s')
    expect(formatDuration(9_400)).toBe('9.4s')
  })

  it('renders whole seconds between 10s and a minute', () => {
    expect(formatDuration(12_000)).toBe('12s')
    expect(formatDuration(59_900)).toBe('59s')
  })

  it('renders minutes and padded seconds under an hour', () => {
    expect(formatDuration(65_000)).toBe('1m 05s')
    expect(formatDuration(3_540_000)).toBe('59m 00s')
  })

  it('renders hours and padded minutes at or above an hour', () => {
    expect(formatDuration(3_720_000)).toBe('1h 02m')
  })
})

describe('scriptRecordTiming', () => {
  it('returns elapsed since startedAt for running records', () => {
    const now = Date.parse('2026-06-19T10:00:05Z')
    const timing = scriptRecordTiming(
      record({ status: 'running', startedAt: '2026-06-19T10:00:00Z' }),
      now
    )
    expect(timing).toEqual({ kind: 'elapsed', label: '5.0s' })
  })

  it('returns no timing for a running record missing startedAt', () => {
    expect(scriptRecordTiming(record({ status: 'running' })).kind).toBe('none')
  })

  it('returns the duration for succeeded and failed records', () => {
    const succeeded = scriptRecordTiming(
      record({
        status: 'succeeded',
        startedAt: '2026-06-19T10:00:00Z',
        endedAt: '2026-06-19T10:00:12Z',
      })
    )
    expect(succeeded).toEqual({ kind: 'duration', label: '12s' })

    const failed = scriptRecordTiming(
      record({
        status: 'failed',
        startedAt: '2026-06-19T10:00:00Z',
        endedAt: '2026-06-19T10:00:00.400Z',
      })
    )
    expect(failed).toEqual({ kind: 'duration', label: '0.4s' })
  })

  it('returns no timing for finished records missing timestamps', () => {
    expect(
      scriptRecordTiming(record({ status: 'succeeded', startedAt: '2026-06-19T10:00:00Z' })).kind
    ).toBe('none')
    expect(
      scriptRecordTiming(record({ status: 'failed', endedAt: '2026-06-19T10:00:00Z' })).kind
    ).toBe('none')
  })

  it('returns no timing for pending and not-reached records', () => {
    expect(scriptRecordTiming(record({ status: 'pending' })).kind).toBe('none')
    expect(scriptRecordTiming(record({ status: 'notReached' })).kind).toBe('none')
  })
})

describe('phaseMeta', () => {
  it('resolves each ordered phase to its metadata via O(1) lookup', () => {
    expect(SCRIPT_EXECUTION_PHASE_ORDER).toEqual(['before', 'after', 'onExit'])
    expect(phaseMeta('before').label).toBe('Before launch')
    expect(phaseMeta('after').label).toBe('After process detected')
    expect(phaseMeta('after').icon).toBe('bolt')
    expect(phaseMeta('onExit').label).toBe('On exit')
  })
})
