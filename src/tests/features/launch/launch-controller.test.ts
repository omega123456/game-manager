import { beforeEach, describe, expect, it } from 'vitest'
import { waitFor } from '@testing-library/react'

import { cancelActiveLaunch, launchGameById } from '@/features/launch/launch-controller'
import { useLaunchStore } from '@/stores/launch-store'
import { useToastStore } from '@/stores/toast-store'
import { ipc } from '@/tests/ipc-mock'

describe('launch-controller', () => {
  beforeEach(() => {
    useLaunchStore.getState().reset()
    useToastStore.setState({ toasts: [] })
  })

  it('optimistically prepares and invokes launch_game', async () => {
    launchGameById(3, 'Cocoon')

    const state = useLaunchStore.getState()
    expect(state.phase).toBe('before')
    expect(state.gameId).toBe(3)
    expect(state.gameName).toBe('Cocoon')

    await waitFor(() => {
      expect(ipc.calls('launch_game')).toEqual([{ gameId: 3 }])
    })
  })

  it('does not roll back after a rejection if the launch state already advanced', async () => {
    ipc.override('launch_game', () => {
      useLaunchStore.getState().applyLifecycle({
        gameId: 3,
        phase: 'playing',
        failedCount: 0,
        elapsedSeconds: 2,
      })
      throw new Error('late failure')
    })

    launchGameById(3, 'Cocoon')

    await waitFor(() => {
      expect(useToastStore.getState().toasts).toHaveLength(1)
    })
    expect(useLaunchStore.getState().phase).toBe('playing')
  })

  it('surfaces a non-blocking toast and rolls back when launch_game rejects', async () => {
    ipc.override('launch_game', () => {
      throw new Error('spawn failed')
    })

    launchGameById(5, 'Hades II')

    await waitFor(() => {
      expect(useToastStore.getState().toasts).toHaveLength(1)
    })
    expect(useToastStore.getState().toasts[0].tone).toBe('error')
    expect(useLaunchStore.getState().phase).toBe('idle')
  })

  it('ignores launch requests while another launch is already active', async () => {
    launchGameById(3, 'Cocoon')
    await waitFor(() => {
      expect(ipc.calls('launch_game')).toEqual([{ gameId: 3 }])
    })

    launchGameById(4, 'Balatro')

    expect(ipc.calls('launch_game')).toEqual([{ gameId: 3 }])
    expect(useLaunchStore.getState().gameId).toBe(3)
  })

  it('cancels the active launch via cancel_launch and disables re-entry', async () => {
    launchGameById(1, 'Alan Wake 2')
    await waitFor(() => expect(ipc.calls('launch_game')).toHaveLength(1))

    cancelActiveLaunch()
    expect(useLaunchStore.getState().cancelling).toBe(true)

    // A second cancel while one is in flight is a no-op.
    cancelActiveLaunch()

    await waitFor(() => {
      expect(ipc.calls('cancel_launch')).toEqual([{ gameId: 1 }])
    })
  })

  it('clears the cancelling flag and logs when cancel_launch rejects', async () => {
    ipc.override('cancel_launch', () => {
      throw new Error('no such launch')
    })
    launchGameById(1, 'Alan Wake 2')
    await waitFor(() => expect(ipc.calls('launch_game')).toHaveLength(1))

    cancelActiveLaunch()
    await waitFor(() => {
      expect(ipc.calls('cancel_launch')).toHaveLength(1)
    })
    await waitFor(() => {
      expect(useLaunchStore.getState().cancelling).toBe(false)
    })
  })

  it('does nothing when cancelling with no active launch', () => {
    cancelActiveLaunch()
    expect(ipc.calls('cancel_launch')).toHaveLength(0)
    expect(useLaunchStore.getState().cancelling).toBe(false)
  })
})
