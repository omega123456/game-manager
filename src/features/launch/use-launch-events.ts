import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { LAUNCH_EVENTS, onLaunchEvent } from '@/lib/ipc/launch-commands'
import { logFrontend } from '@/lib/app-log-commands'
import { gameDetailQueryKey } from '@/lib/queries/use-games'
import { GAMES_QUERY_KEY, PLAY_NOW_QUERY_KEY } from '@/lib/queries/query-keys'
import { isTickingPhase, useLaunchStore } from '@/stores/launch-store'
import type { LaunchLifecycle } from '@/types/domain'

/** How long the banner's "Done" summary lingers before fading. */
export const DONE_FADE_MS = 3000

declare global {
  interface Window {
    /**
     * Deterministic test hook (only installed under `VITE_PLAYWRIGHT`): pushes a
     * lifecycle payload straight into the launch-store so Playwright can drive the
     * banner through its phases without the Tauri event runtime.
     */
    __gmLaunch__?: (payload: LaunchLifecycle) => void
  }
}

/**
 * Subscribe (once, at app mount) to the `launch://*` lifecycle channels, feed the
 * launch-store, run the live elapsed counter, invalidate library/detail caches on
 * session end, and schedule the "Done" summary fade. Cleans up all subscriptions,
 * the interval, and timers on unmount.
 */
export function useLaunchEvents(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    const applyLifecycle = useLaunchStore.getState().applyLifecycle

    function handle(payload: LaunchLifecycle): void {
      const wasActive = useLaunchStore.getState().gameId
      applyLifecycle(payload)

      if (payload.phase === 'ended') {
        const endedGameId = wasActive ?? payload.gameId
        void queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY })
        void queryClient.invalidateQueries({ queryKey: PLAY_NOW_QUERY_KEY })
        if (typeof endedGameId === 'number') {
          void queryClient.invalidateQueries({ queryKey: gameDetailQueryKey(endedGameId) })
        }
      }
    }

    const unlisteners: Array<() => void> = []
    let cancelled = false

    void Promise.all([
      onLaunchEvent(LAUNCH_EVENTS.phase, handle),
      onLaunchEvent(LAUNCH_EVENTS.error, handle),
      onLaunchEvent(LAUNCH_EVENTS.ended, handle),
    ])
      .then((fns) => {
        if (cancelled) {
          fns.forEach((fn) => fn())
          return
        }
        unlisteners.push(...fns)
      })
      .catch((error: unknown) => {
        logFrontend('warn', 'Failed to subscribe to launch events.', {
          category: 'launch.events',
          details: error instanceof Error ? error.message : String(error),
        })
      })

    // Live counter: tick once per second only while in a ticking phase.
    const interval = window.setInterval(() => {
      if (isTickingPhase(useLaunchStore.getState().phase)) {
        useLaunchStore.getState().tick()
      }
    }, 1000)

    // Deterministic E2E driver — only under the Playwright web build.
    if (import.meta.env.VITE_PLAYWRIGHT === 'true') {
      window.__gmLaunch__ = handle
    }

    return () => {
      cancelled = true
      unlisteners.forEach((fn) => fn())
      window.clearInterval(interval)
      if (import.meta.env.VITE_PLAYWRIGHT === 'true') {
        delete window.__gmLaunch__
      }
    }
  }, [queryClient])

  // Schedule the "Done" summary fade whenever a new summary appears.
  const done = useLaunchStore((state) => state.done)
  useEffect(() => {
    if (!done) {
      return
    }
    const timer = window.setTimeout(() => {
      useLaunchStore.getState().clearDone()
    }, DONE_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [done])
}
