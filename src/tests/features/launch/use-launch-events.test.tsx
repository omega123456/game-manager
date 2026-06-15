import { act, render, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'

import { LAUNCH_EVENTS } from '@/lib/ipc/launch-commands'
import { createQueryClient } from '@/lib/query-client'
import { useLaunchEvents } from '@/features/launch/use-launch-events'
import { useLaunchStore } from '@/stores/launch-store'
import { ipc } from '@/tests/ipc-mock'

function Harness(): React.JSX.Element {
  useLaunchEvents()
  return <div data-testid="harness" />
}

function renderHarness() {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  )
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
})
