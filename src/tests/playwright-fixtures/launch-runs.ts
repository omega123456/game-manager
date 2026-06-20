import type { LaunchRun, ScriptExecutionStatus } from '@/types/domain'

import type { PlaywrightFixtureHandler } from './index'

type LaunchRunScenario = 'default' | 'active' | 'failed' | 'none'

function getLaunchRunScenario(): LaunchRunScenario {
  if (typeof window === 'undefined') {
    return 'default'
  }

  const [, search = ''] = window.location.hash.split('?')
  const value = new URLSearchParams(search).get('launchRunFixture')
  switch (value) {
    case 'active':
    case 'failed':
    case 'none':
      return value
    default:
      return 'default'
  }
}

function scriptRecord(
  id: number,
  phase: LaunchRun['scriptRecords'][number]['phase'],
  status: ScriptExecutionStatus,
  overrides: Partial<LaunchRun['scriptRecords'][number]> = {}
): LaunchRun['scriptRecords'][number] {
  return {
    id,
    launchRunId: 101,
    scriptId: id,
    name: `Script ${id}`,
    phase,
    provenance: 'direct',
    order: 1,
    priority: 5,
    requiredUtilityNames: [],
    status,
    ...overrides,
  }
}

function createLaunchRun(overrides: Partial<LaunchRun> & Pick<LaunchRun, 'gameId'>): LaunchRun {
  return {
    id: 101,
    gameId: overrides.gameId,
    status: 'completed',
    startedAt: '2026-06-19T10:00:00Z',
    endedAt: '2026-06-19T10:01:15Z',
    failureCount: 0,
    scriptRecords: [
      scriptRecord(1, 'before', 'succeeded', {
        name: 'Auto-Save Manager',
        requiredUtilityNames: ['SaveLib'],
        startedAt: '2026-06-19T10:00:00Z',
        endedAt: '2026-06-19T10:00:02Z',
      }),
      scriptRecord(2, 'after', 'succeeded', {
        name: 'HDR Toggle',
        provenance: 'global',
        startedAt: '2026-06-19T10:00:04Z',
        endedAt: '2026-06-19T10:00:16Z',
      }),
      scriptRecord(3, 'onExit', 'succeeded', {
        name: 'Restore HDR',
        provenance: 'global',
        startedAt: '2026-06-19T10:01:00Z',
        endedAt: '2026-06-19T10:01:00.400Z',
      }),
    ],
    ...overrides,
  }
}

export const launchRunFixtures: Record<string, PlaywrightFixtureHandler> = {
  get_latest_launch_run: (args) => {
    const gameId = Number(args?.gameId ?? 0)
    const scenario = getLaunchRunScenario()

    if (scenario === 'none') {
      return null
    }

    if (scenario === 'active') {
      return createLaunchRun({
        gameId,
        status: 'active',
        endedAt: undefined,
        scriptRecords: [
          scriptRecord(1, 'before', 'succeeded', {
            name: 'Auto-Save Manager',
            requiredUtilityNames: ['SaveLib'],
            startedAt: '2026-06-19T10:00:00Z',
            endedAt: '2026-06-19T10:00:03Z',
          }),
          // Running rows derive their elapsed chip from the wall clock, which
          // is non-deterministic; omit startedAt so the screenshot stays stable
          // while the succeeded row above exercises the (deterministic) chip.
          scriptRecord(2, 'after', 'running', {
            name: 'HDR Toggle',
            provenance: 'global',
          }),
          scriptRecord(3, 'onExit', 'pending', {
            name: 'Restore HDR',
            provenance: 'global',
          }),
        ],
      })
    }

    if (scenario === 'failed') {
      return createLaunchRun({
        gameId,
        failureCount: 1,
        scriptRecords: [
          scriptRecord(1, 'before', 'succeeded', {
            name: 'Auto-Save Manager',
            requiredUtilityNames: ['SaveLib'],
            startedAt: '2026-06-19T10:00:00Z',
            endedAt: '2026-06-19T10:00:02Z',
          }),
          scriptRecord(2, 'after', 'failed', {
            name: 'HDR Toggle',
            provenance: 'global',
            details: 'Process attach timed out',
            startedAt: '2026-06-19T10:00:05Z',
            endedAt: '2026-06-19T10:00:35Z',
          }),
          scriptRecord(3, 'onExit', 'notReached', {
            name: 'Restore HDR',
            provenance: 'global',
          }),
        ],
      })
    }

    return createLaunchRun({ gameId })
  },
}
