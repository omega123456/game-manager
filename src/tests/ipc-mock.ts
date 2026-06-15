/**
 * Centralized IPC mock infrastructure for Vitest tests.
 *
 * Usage:
 *   import { ipc } from './ipc-mock'
 *
 *   // Per-test command override:
 *   ipc.override('list_games', () => [{ id: 1, name: 'Elden Ring' }])
 *
 *   // Inspect recorded calls:
 *   ipc.calls('create_game')
 *
 *   // Emit a Tauri event to real listeners (shouldMockEvents:true):
 *   await ipc.emit('launch://phase', { gameId: 1, phase: 'before' })
 *
 * `setupIpc()` is called once at module scope in `setup.ts`; it registers the
 * beforeEach/afterEach hooks. All Vitest tests that touch Tauri IPC MUST go
 * through this harness — never use ad hoc `mockIPC`, per-test `vi.mock` of
 * `@tauri-apps/api/*`, or direct mocks of `src/lib/*-commands.ts` wrappers.
 */

import { act } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { emit } from '@tauri-apps/api/event'
import type { InvokeArgs } from '@tauri-apps/api/core'

import { IPC_FIXTURES, type IpcHandler } from './fixtures'

/** Per-test command overrides — take precedence over IPC_FIXTURES. */
const _overrides = new Map<string, IpcHandler>()

/** Recorded call payloads per command, captured at call time. */
const _calls = new Map<string, unknown[]>()

export const ipc = {
  /**
   * Register a per-test override for a specific IPC command. Cleared after each
   * test via afterEach. The wildcard '*' is not allowed.
   */
  override(commandName: string, handlerFn: IpcHandler): void {
    if (commandName === '*') {
      throw new Error('[ipc-mock] Wildcard override not allowed — use specific command names')
    }
    _overrides.set(commandName, handlerFn)
  },

  /** Recorded call payloads (deep-cloned snapshots) for the given command. */
  calls(commandName: string): unknown[] {
    return _calls.get(commandName) ?? []
  },

  /** Emit a Tauri event to all registered listeners (wrapped in `act` for React). */
  emit<T = unknown>(eventName: string, payload?: T): Promise<void> {
    return act(async () => {
      await emit(eventName, payload)
    })
  },

  /** Clear all overrides and call records. Called automatically by afterEach. */
  reset(): void {
    _overrides.clear()
    _calls.clear()
  },
} as const

/** Register multiple per-test IPC overrides in one call. */
export function overrideIpcCommands(overrides: Record<string, IpcHandler>): void {
  Object.entries(overrides).forEach(([cmd, handler]) => ipc.override(cmd, handler))
}

/**
 * Registers beforeEach/afterEach hooks to install + tear down the IPC mock.
 *
 * Resolution order on each invoke:
 *   1. Per-test override (ipc.override)
 *   2. Default fixture (IPC_FIXTURES)
 *   3. Throw `[vitest] Unmocked Tauri IPC command: <cmd>` — loud by design.
 */
export function setupIpc(): void {
  beforeEach(() => {
    mockIPC(
      (cmd: string, payload?: InvokeArgs) => {
        const args =
          payload !== null &&
          typeof payload === 'object' &&
          !Array.isArray(payload) &&
          !(payload instanceof ArrayBuffer) &&
          !(payload instanceof Uint8Array)
            ? (payload as Record<string, unknown>)
            : undefined

        const prev = _calls.get(cmd) ?? []
        prev.push(args !== undefined ? JSON.parse(JSON.stringify(args)) : undefined)
        _calls.set(cmd, prev)

        const override = _overrides.get(cmd)
        if (override) {
          return override(args, cmd)
        }

        const fixture = IPC_FIXTURES[cmd]
        if (fixture) {
          return fixture(args, cmd)
        }

        throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
      },
      { shouldMockEvents: true }
    )
  })

  afterEach(() => {
    ipc.reset()
    clearMocks()
  })
}
