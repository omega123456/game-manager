import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { LaunchLifecycle, ScriptExecutionUpdated } from '@/types/domain'

/**
 * Launch lifecycle event channels emitted by the backend orchestrator. The
 * launch store (Phase E2) subscribes to these; keep the names in lock-step with
 * the Rust `launch::events` constants.
 */
export const LAUNCH_EVENTS = {
  /** Emitted on each lifecycle phase transition. */
  phase: 'launch://phase',
  /** Emitted (in addition to a phase event) when a script result fails. */
  error: 'launch://error',
  /** Emitted once when the session has ended (success, failure, or cancel). */
  ended: 'launch://ended',
  /** Emitted after each committed script-execution ledger write. */
  scriptExecutionUpdated: 'launch://script-execution-updated',
} as const

/** A launch event channel name. */
export type LaunchLifecycleEventName =
  | (typeof LAUNCH_EVENTS)['phase']
  | (typeof LAUNCH_EVENTS)['error']
  | (typeof LAUNCH_EVENTS)['ended']

/**
 * Launch a game's resolved script pipeline. Fire-and-forget on the backend: it
 * returns immediately and reports progress via the `launch://*` events.
 */
export function launchGame(gameId: number): Promise<void> {
  return invoke<void>('launch_game', { gameId })
}

/**
 * Cancel an in-flight launch for a game. Resolves to whether a launch was active
 * to cancel.
 */
export function cancelLaunch(gameId: number): Promise<boolean> {
  return invoke<boolean>('cancel_launch', { gameId })
}

/**
 * Subscribe to a launch lifecycle channel, invoking `handler` with each
 * [`LaunchLifecycle`] payload. Returns the unlisten function.
 */
export function onLaunchEvent(
  event: LaunchLifecycleEventName,
  handler: (payload: LaunchLifecycle) => void
): Promise<UnlistenFn> {
  return listen<LaunchLifecycle>(event, (e) => handler(e.payload))
}

/** Subscribe to script-execution update events for latest-run query refreshes. */
export function onScriptExecutionUpdated(
  handler: (payload: ScriptExecutionUpdated) => void
): Promise<UnlistenFn> {
  return listen<ScriptExecutionUpdated>(LAUNCH_EVENTS.scriptExecutionUpdated, (e) =>
    handler(e.payload)
  )
}
