import { act, render, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'

import { LAUNCH_EVENTS } from '@/lib/ipc/launch-commands'
import { createQueryClient } from '@/lib/query-client'
import { useLaunchEvents } from '@/features/launch/use-launch-events'
import { latestLaunchRunQueryKey, useLatestLaunchRunQuery } from '@/lib/queries/use-games'
import { useLaunchStore } from '@/stores/launch-store'
import { ipc } from '@/tests/ipc-mock'

function Harness(): React.JSX.Element {
  useLaunchEvents()
  return <div data-testid="harness" />
}

function renderHarness() {
  const client = createQueryClient()
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    ),
  }
}

function LatestRunQueryHarness({ gameId }: { gameId: number }): React.JSX.Element {
  useLatestLaunchRunQuery(gameId)
  return <div data-testid="latest-run-query" />
}

function renderWithLatestRunQuery(gameId: number) {
  const client = createQueryClient()
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <Harness />
        <LatestRunQueryHarness gameId={gameId} />
      </QueryClientProvider>
    ),
  }
}

describe('useLaunchEvents', () => {
  beforeEach(() => {
    useLaunchStore.getState().reset()
  })

  it('feeds emitted lifecycle events into the launch-store and cleans up on unmount', async () => {
    const { unmount } = renderHarness()

    await waitFor(async () => {
      await ipc.emit(LAUNCH_EVENTS.phase, {
        gameId: 1,
        phase: 'playing',
        failedCount: 0,
        elapsedSeconds: 5,
      })
      expect(useLaunchStore.getState().phase).toBe('playing')
    })

    await act(async () => {
      unmount()
      await Promise.resolve()
    })

    expect(useLaunchStore.getState().phase).toBe('playing')
    useLaunchStore.getState().reset()
  })

  it('invalidates the games cache when a session ends', async () => {
    renderHarness()

    await ipc.emit(LAUNCH_EVENTS.phase, {
      gameId: 1,
      phase: 'playing',
      failedCount: 0,
      elapsedSeconds: 10,
    })
    await waitFor(() => expect(useLaunchStore.getState().phase).toBe('playing'))

    await ipc.emit(LAUNCH_EVENTS.ended, {
      gameId: 1,
      phase: 'ended',
      failedCount: 0,
      elapsedSeconds: 10,
    })

    await waitFor(() => {
      expect(useLaunchStore.getState().done).not.toBeNull()
    })
  })

  it('invalidates the affected latest-run query after script-execution updates', async () => {
    let latestRunCalls = 0
    ipc.override('get_latest_launch_run', () => {
      latestRunCalls += 1
      return {
        id: 41,
        gameId: 1,
        status: 'active',
        startedAt: '2026-06-19T10:00:00Z',
        failureCount: 0,
        scriptRecords: [],
      }
    })

    const { client } = renderWithLatestRunQuery(1)

    await waitFor(() => expect(latestRunCalls).toBe(1))
    expect(client.getQueryData(latestLaunchRunQueryKey(1))).toMatchObject({
      id: 41,
      gameId: 1,
    })

    await ipc.emit(LAUNCH_EVENTS.scriptExecutionUpdated, {
      gameId: 1,
      launchRunId: 41,
    })

    await waitFor(() => expect(latestRunCalls).toBeGreaterThan(1))
  })
})
