import { beforeEach, describe, expect, it } from 'vitest'

import { isGameRunningPhase, isTickingPhase, useLaunchStore } from '@/stores/launch-store'
import type { LaunchLifecycle } from '@/types/domain'

function lifecycle(
  partial: Partial<LaunchLifecycle> & Pick<LaunchLifecycle, 'phase'>
): LaunchLifecycle {
  return { gameId: 1, failedCount: 0, ...partial }
}

describe('launch-store', () => {
  beforeEach(() => {
    useLaunchStore.getState().reset()
  })

  it('starts idle', () => {
    const state = useLaunchStore.getState()
    expect(state.phase).toBe('idle')
    expect(state.isActive()).toBe(false)
    expect(state.gameId).toBeNull()
  })

  it('enters the before phase optimistically on startPreparing', () => {
    useLaunchStore.getState().startPreparing(7, 'Hades II')
    const state = useLaunchStore.getState()
    expect(state.phase).toBe('before')
    expect(state.gameId).toBe(7)
    expect(state.gameName).toBe('Hades II')
    expect(state.isActive()).toBe(true)
  })

  it('advances through lifecycle phases from events', () => {
    const { applyLifecycle } = useLaunchStore.getState()
    applyLifecycle(lifecycle({ phase: 'before', detail: '1/2 scripts' }))
    expect(useLaunchStore.getState().phase).toBe('before')
    expect(useLaunchStore.getState().detail).toBe('1/2 scripts')

    applyLifecycle(lifecycle({ phase: 'waitingForProcess', elapsedSeconds: 3 }))
    expect(useLaunchStore.getState().phase).toBe('waitingForProcess')
    expect(useLaunchStore.getState().elapsedSeconds).toBe(0)

    applyLifecycle(lifecycle({ phase: 'playing', elapsedSeconds: 10 }))
    expect(useLaunchStore.getState().phase).toBe('playing')
    expect(useLaunchStore.getState().elapsedSeconds).toBe(10)
  })

  it('captures a done summary on the ended event and resets the live phase', () => {
    const { applyLifecycle } = useLaunchStore.getState()
    applyLifecycle(lifecycle({ phase: 'playing', elapsedSeconds: 8040 }))
    applyLifecycle(lifecycle({ phase: 'ended', elapsedSeconds: 8040 }))

    const state = useLaunchStore.getState()
    expect(state.phase).toBe('idle')
    expect(state.isActive()).toBe(false)
    expect(state.done).toEqual({ gameId: 1, playtimeSeconds: 8040, cancelled: false })
  })

  it('marks the done summary as cancelled when a cancel was in flight', () => {
    const { applyLifecycle, setCancelling } = useLaunchStore.getState()
    applyLifecycle(lifecycle({ phase: 'waitingForProcess', elapsedSeconds: 5 }))
    setCancelling(true)
    applyLifecycle(lifecycle({ phase: 'ended', elapsedSeconds: 5 }))

    expect(useLaunchStore.getState().done?.cancelled).toBe(true)
  })

  it('tracks a non-blocking failed-script count from events', () => {
    useLaunchStore.getState().applyLifecycle(lifecycle({ phase: 'before', failedCount: 2 }))
    expect(useLaunchStore.getState().failedCount).toBe(2)
  })

  it('ignores stale events for a different game once a launch is active', () => {
    const { startPreparing, applyLifecycle } = useLaunchStore.getState()
    startPreparing(1, 'Alan Wake 2')
    applyLifecycle(lifecycle({ gameId: 2, phase: 'playing', elapsedSeconds: 99 }))
    const state = useLaunchStore.getState()
    expect(state.gameId).toBe(1)
    expect(state.phase).toBe('before')
  })

  it('ignores a stale ended event from an earlier run of the same game after a rapid relaunch', () => {
    const { applyLifecycle } = useLaunchStore.getState()

    // Run 1 (runId 10) reaches onExit; its backend-side 'ended' event is
    // in flight but hasn't arrived yet.
    applyLifecycle(lifecycle({ phase: 'before', runId: 10 }))
    applyLifecycle(lifecycle({ phase: 'onExit', runId: 10, elapsedSeconds: 42 }))

    // The user relaunches the same game before that 'ended' event lands —
    // the backend opens run 11.
    applyLifecycle(lifecycle({ phase: 'before', runId: 11 }))
    expect(useLaunchStore.getState().runId).toBe(11)

    applyLifecycle(lifecycle({ phase: 'onExit', runId: 11, elapsedSeconds: 5 }))
    expect(useLaunchStore.getState().phase).toBe('onExit')
    expect(useLaunchStore.getState().isActive()).toBe(true)

    // The straggling 'ended' from run 10 finally arrives — it must not reset
    // the store while run 11's on-exit scripts are still active.
    applyLifecycle(lifecycle({ phase: 'ended', runId: 10, elapsedSeconds: 42 }))
    expect(useLaunchStore.getState().phase).toBe('onExit')
    expect(useLaunchStore.getState().isActive()).toBe(true)

    // Run 11's own 'ended' event correctly clears the store.
    applyLifecycle(lifecycle({ phase: 'ended', runId: 11, elapsedSeconds: 5 }))
    expect(useLaunchStore.getState().isActive()).toBe(false)
  })

  it('ticks the counter only during the playing phase', () => {
    const { applyLifecycle, tick } = useLaunchStore.getState()
    applyLifecycle(lifecycle({ phase: 'before' }))
    tick()
    expect(useLaunchStore.getState().elapsedSeconds).toBe(0)

    applyLifecycle(lifecycle({ phase: 'waitingForProcess' }))
    tick()
    tick()
    expect(useLaunchStore.getState().elapsedSeconds).toBe(0)

    applyLifecycle(lifecycle({ phase: 'playing' }))
    tick()
    tick()
    expect(useLaunchStore.getState().elapsedSeconds).toBe(2)
  })

  it('keeps the local elapsed value when a phase event omits elapsedSeconds', () => {
    const { applyLifecycle, tick } = useLaunchStore.getState()
    applyLifecycle(lifecycle({ phase: 'playing', elapsedSeconds: 4 }))
    tick()
    applyLifecycle(lifecycle({ phase: 'playing' }))
    expect(useLaunchStore.getState().elapsedSeconds).toBe(5)
  })

  it('clearDone only clears when idle', () => {
    const { applyLifecycle, clearDone } = useLaunchStore.getState()
    applyLifecycle(lifecycle({ phase: 'ended', elapsedSeconds: 1 }))
    expect(useLaunchStore.getState().done).not.toBeNull()
    clearDone()
    expect(useLaunchStore.getState().done).toBeNull()
  })

  it('isTickingPhase reports true only for the playing phase', () => {
    expect(isTickingPhase('playing')).toBe(true)
    expect(isTickingPhase('waitingForProcess')).toBe(false)
    expect(isTickingPhase('before')).toBe(false)
    expect(isTickingPhase('idle')).toBe(false)
  })

  it('isGameRunningPhase is true only while playing', () => {
    expect(isGameRunningPhase('playing')).toBe(true)
    expect(isGameRunningPhase('waitingForProcess')).toBe(false)
    expect(isGameRunningPhase('before')).toBe(false)
    expect(isGameRunningPhase('idle')).toBe(false)
  })
})
