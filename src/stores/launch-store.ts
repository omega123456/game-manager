import { create } from 'zustand'

import type { LaunchLifecycle, LaunchPhase } from '@/types/domain'

/** Live launch phase, extended with an `idle` sentinel for "no active launch". */
export type LiveLaunchPhase = LaunchPhase | 'idle'

/**
 * A finished session summary shown briefly in the banner's "Done" state before it
 * fades away. `playtimeSeconds` is the elapsed time the backend reported on the
 * terminal `ended` event (best-effort; 0 when unknown).
 */
export interface LaunchDoneSummary {
  gameId: number
  playtimeSeconds: number
  /** Whether the session ended because the user cancelled it. */
  cancelled: boolean
}

export interface LaunchState {
  /** The game id currently being launched/played, or null when idle. */
  gameId: number | null
  /** Best-effort display name for the active game (set on optimistic start). */
  gameName: string | null
  /** Current live phase (`idle` when no launch is active). */
  phase: LiveLaunchPhase
  /** Optional human detail from the latest lifecycle event (e.g. "2/3 scripts"). */
  detail: string | null
  /** Number of script failures reported so far (non-blocking). */
  failedCount: number
  /** Live elapsed seconds since the wait-for-process / playing window began. */
  elapsedSeconds: number
  /** Whether a cancel request is in flight (disables the Cancel control). */
  cancelling: boolean
  /** Summary of the just-ended session while the banner shows its "Done" state. */
  done: LaunchDoneSummary | null

  /** True while a launch is active (anything other than `idle`). */
  isActive: () => boolean

  /** Optimistically enter the `before` phase when the user presses Launch. */
  startPreparing: (gameId: number, gameName?: string) => void
  /** Apply a lifecycle event payload (the single source of phase truth). */
  applyLifecycle: (payload: LaunchLifecycle) => void
  /** Mark that a cancel request is in flight. */
  setCancelling: (cancelling: boolean) => void
  /** Advance the local elapsed counter by one second (between events). */
  tick: () => void
  /** Clear the transient "Done" summary (called after the fade timeout). */
  clearDone: () => void
  /** Reset to the idle state. */
  reset: () => void
}

const IDLE = {
  gameId: null,
  gameName: null,
  phase: 'idle' as LiveLaunchPhase,
  detail: null,
  failedCount: 0,
  elapsedSeconds: 0,
  cancelling: false,
  done: null,
}

/** Phases during which the local elapsed counter should be running. */
export function isTickingPhase(phase: LiveLaunchPhase): boolean {
  return phase === 'waitingForProcess' || phase === 'playing'
}

/** True while a game process is active — used to throttle UI churn during play. */
export function isGameRunningPhase(phase: LiveLaunchPhase): boolean {
  return phase === 'playing'
}

export const useLaunchStore = create<LaunchState>((set, get) => ({
  ...IDLE,

  isActive: () => get().phase !== 'idle',

  startPreparing: (gameId, gameName) =>
    set({
      ...IDLE,
      gameId,
      gameName: gameName ?? null,
      phase: 'before',
    }),

  applyLifecycle: (payload) =>
    set((state) => {
      // Ignore stale events for a game other than the active one once a launch is
      // in progress (e.g. straggling events after reset), but always accept the
      // first event that opens a session.
      if (state.phase !== 'idle' && state.gameId !== null && payload.gameId !== state.gameId) {
        return state
      }

      if (payload.phase === 'ended') {
        return {
          ...IDLE,
          done: {
            gameId: payload.gameId,
            playtimeSeconds: payload.elapsedSeconds ?? state.elapsedSeconds,
            cancelled: state.cancelling,
          },
        }
      }

      // Prefer the backend-reported elapsed seconds when present; otherwise keep
      // the locally-ticked value (so the counter never jumps backwards on a phase
      // event that omits elapsed).
      const elapsedSeconds = payload.elapsedSeconds ?? state.elapsedSeconds

      return {
        gameId: payload.gameId,
        gameName: state.gameId === payload.gameId ? state.gameName : null,
        phase: payload.phase,
        detail: payload.detail ?? null,
        failedCount: payload.failedCount,
        elapsedSeconds: isTickingPhase(payload.phase) ? elapsedSeconds : state.elapsedSeconds,
        cancelling: state.cancelling,
        done: null,
      }
    }),

  setCancelling: (cancelling) => set({ cancelling }),

  tick: () =>
    set((state) =>
      isTickingPhase(state.phase)
        ? { elapsedSeconds: state.elapsedSeconds + 1 }
        : state
    ),

  clearDone: () => set((state) => (state.phase === 'idle' ? { done: null } : state)),

  reset: () => set({ ...IDLE }),
}))
