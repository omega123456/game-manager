import type {
  LaunchRun,
  LaunchScriptRecord,
  Provenance,
  ScriptExecutionStatus,
  ScriptPhase,
} from '@/types/domain'

export interface ScriptExecutionPhaseMeta {
  phase: ScriptPhase
  label: string
  icon: string
  emptyLabel: string
}

export interface ScriptExecutionStatusMeta {
  status: ScriptExecutionStatus
  label: string
  icon: string
}

export type ScriptExecutionViewState = 'loading' | 'empty' | 'live' | 'retained'

export interface ScriptExecutionViewMeta {
  state: ScriptExecutionViewState
  label: string
  summary: string
}

export const SCRIPT_EXECUTION_PHASES: Record<ScriptPhase, ScriptExecutionPhaseMeta> = {
  before: {
    phase: 'before',
    label: 'Before launch',
    icon: 'schedule',
    emptyLabel: 'No scripts queued before launch.',
  },
  after: {
    phase: 'after',
    label: 'After process detected',
    icon: 'bolt',
    emptyLabel: 'No scripts queued after process detection.',
  },
  onExit: {
    phase: 'onExit',
    label: 'On exit',
    icon: 'logout',
    emptyLabel: 'No scripts queued for game exit.',
  },
}

/** Phase render order (Before launch → After process detected → On exit). */
export const SCRIPT_EXECUTION_PHASE_ORDER: readonly ScriptPhase[] = ['before', 'after', 'onExit']

export const SCRIPT_EXECUTION_STATUS: Record<ScriptExecutionStatus, ScriptExecutionStatusMeta> = {
  pending: {
    status: 'pending',
    label: 'Pending',
    icon: 'radio_button_unchecked',
  },
  running: {
    status: 'running',
    label: 'Running',
    icon: 'autorenew',
  },
  succeeded: {
    status: 'succeeded',
    label: 'Succeeded',
    icon: 'check_circle',
  },
  failed: {
    status: 'failed',
    label: 'Failed',
    icon: 'warning',
  },
  notReached: {
    status: 'notReached',
    label: 'Not reached',
    icon: 'do_not_disturb_on',
  },
}

export function phaseMeta(phase: ScriptPhase): ScriptExecutionPhaseMeta {
  return SCRIPT_EXECUTION_PHASES[phase]
}

export function statusMeta(status: ScriptExecutionStatus): ScriptExecutionStatusMeta {
  return SCRIPT_EXECUTION_STATUS[status]
}

function runSummaryLabel(run: LaunchRun): string {
  const scriptCount = run.scriptRecords.length
  const scriptLabel = `${scriptCount} script${scriptCount === 1 ? '' : 's'}`
  if (run.failureCount > 0) {
    return `${scriptLabel} · ${run.failureCount} failed`
  }

  return scriptLabel
}

export function getScriptExecutionViewMeta(args: {
  isLoading: boolean
  run: LaunchRun | null | undefined
}): ScriptExecutionViewMeta {
  const { isLoading, run } = args

  if (isLoading) {
    return {
      state: 'loading',
      label: 'Loading',
      summary: 'Loading script execution details…',
    }
  }

  if (!run) {
    return {
      state: 'empty',
      label: 'No session',
      summary: 'No retained script execution',
    }
  }

  if (run.status === 'active') {
    return {
      state: 'live',
      label: 'Live',
      summary: runSummaryLabel(run),
    }
  }

  return {
    state: 'retained',
    label: 'Retained session',
    summary: runSummaryLabel(run),
  }
}

export function groupScriptRecordsByPhase(
  records: LaunchScriptRecord[]
): Record<ScriptPhase, LaunchScriptRecord[]> {
  return {
    before: records.filter((record) => record.phase === 'before'),
    after: records.filter((record) => record.phase === 'after'),
    onExit: records.filter((record) => record.phase === 'onExit'),
  }
}

export function formatScriptProvenance(provenance: Provenance, groupName?: string): string {
  switch (provenance) {
    case 'direct':
      return 'Direct'
    case 'global':
      return 'Global'
    case 'group':
      return groupName ? `Group: ${groupName}` : 'Group'
    default:
      return 'Direct'
  }
}

export function formatScriptUtilityMeta(requiredUtilityNames: string[]): string {
  if (requiredUtilityNames.length === 0) {
    return 'No utilities required'
  }

  return `Requires ${requiredUtilityNames.join(', ')}`
}

/**
 * Format a non-negative millisecond duration into a compact monospace-friendly
 * label (e.g. `0.4s`, `12s`, `1m 05s`, `1h 02m`). Negative/NaN inputs clamp to
 * `0.0s` so a clock-skewed record never renders a nonsensical chip.
 */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return '0.0s'
  }

  const totalSeconds = durationMs / 1000
  if (totalSeconds < 10) {
    return `${totalSeconds.toFixed(1)}s`
  }

  const wholeSeconds = Math.floor(totalSeconds)
  if (wholeSeconds < 60) {
    return `${wholeSeconds}s`
  }

  const minutes = Math.floor(wholeSeconds / 60)
  const seconds = wholeSeconds % 60
  if (minutes < 60) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  }

  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return `${hours}h ${String(remMinutes).padStart(2, '0')}m`
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Kind of timing chip a script-execution row should render.
 *
 * - `elapsed` — a running record; the value is the time since it started.
 * - `duration` — a finished record (succeeded/failed); the value is its runtime.
 * - `none` — pending / not-reached / un-timestamped records show no chip.
 */
export interface ScriptRecordTiming {
  kind: 'elapsed' | 'duration' | 'none'
  label: string
}

const NO_TIMING: ScriptRecordTiming = { kind: 'none', label: '' }

/**
 * Derive the per-row timing chip for a script-execution record.
 *
 * Running records show elapsed time since `startedAt`; completed records
 * (succeeded/failed) show their `endedAt - startedAt` duration. Pending and
 * not-reached records — or any record missing the timestamps it needs — show
 * nothing. `now` is injectable for deterministic tests.
 */
export function scriptRecordTiming(
  record: Pick<LaunchScriptRecord, 'status' | 'startedAt' | 'endedAt'>,
  now: number = Date.now()
): ScriptRecordTiming {
  const startedAt = parseTimestamp(record.startedAt)

  if (record.status === 'running') {
    if (startedAt === null) {
      return NO_TIMING
    }
    return { kind: 'elapsed', label: formatDuration(now - startedAt) }
  }

  if (record.status === 'succeeded' || record.status === 'failed') {
    const endedAt = parseTimestamp(record.endedAt)
    if (startedAt === null || endedAt === null) {
      return NO_TIMING
    }
    return { kind: 'duration', label: formatDuration(endedAt - startedAt) }
  }

  return NO_TIMING
}
