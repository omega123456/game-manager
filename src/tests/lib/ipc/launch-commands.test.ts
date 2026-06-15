import { afterEach, describe, expect, it, vi } from 'vitest'

import { cancelLaunch, launchGame, LAUNCH_EVENTS, onLaunchEvent } from '@/lib/ipc/launch-commands'
import type { LaunchLifecycle } from '@/types/domain'

import { ipc } from '../../ipc-mock'

describe('launch-commands', () => {
  it('launches a game forwarding the gameId', async () => {
    await launchGame(5)
    expect(ipc.calls('launch_game')).toEqual([{ gameId: 5 }])
  })

  it('cancels a launch forwarding the gameId and resolving the active flag', async () => {
    ipc.override('cancel_launch', () => true)
    await expect(cancelLaunch(8)).resolves.toBe(true)
    expect(ipc.calls('cancel_launch')).toEqual([{ gameId: 8 }])
  })

  it('cancel resolves false when no launch is active (default fixture)', async () => {
    await expect(cancelLaunch(99)).resolves.toBe(false)
  })

  it('exposes the launch event channel names', () => {
    expect(LAUNCH_EVENTS).toEqual({
      phase: 'launch://phase',
      error: 'launch://error',
      ended: 'launch://ended',
    })
  })

  describe('onLaunchEvent', () => {
    const unlisteners: Array<() => void> = []

    afterEach(() => {
      unlisteners.splice(0).forEach((fn) => fn())
    })

    it('delivers phase payloads to the handler', async () => {
      const handler = vi.fn<(payload: LaunchLifecycle) => void>()
      const unlisten = await onLaunchEvent(LAUNCH_EVENTS.phase, handler)
      unlisteners.push(unlisten)

      const payload: LaunchLifecycle = {
        gameId: 1,
        phase: 'before',
        failedCount: 0,
      }
      await ipc.emit(LAUNCH_EVENTS.phase, payload)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(payload)
    })

    it('delivers ended payloads with elapsed + failed counts', async () => {
      const handler = vi.fn<(payload: LaunchLifecycle) => void>()
      const unlisten = await onLaunchEvent(LAUNCH_EVENTS.ended, handler)
      unlisteners.push(unlisten)

      const payload: LaunchLifecycle = {
        gameId: 2,
        phase: 'ended',
        failedCount: 1,
        elapsedSeconds: 142,
        detail: 'cancelled',
      }
      await ipc.emit(LAUNCH_EVENTS.ended, payload)

      expect(handler).toHaveBeenCalledWith(payload)
    })

    it('returns an unlisten function after the first delivery', async () => {
      const handler = vi.fn<(payload: LaunchLifecycle) => void>()
      const unlisten = await onLaunchEvent(LAUNCH_EVENTS.error, handler)

      await ipc.emit(LAUNCH_EVENTS.error, {
        gameId: 3,
        phase: 'before',
        failedCount: 1,
      })
      expect(handler).toHaveBeenCalledTimes(1)

      await expect(unlisten()).resolves.toBeUndefined()
      handler.mockClear()
      expect(handler).not.toHaveBeenCalled()
    })
  })
})
