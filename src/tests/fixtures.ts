/**
 * Default IPC response fixtures for Vitest tests.
 *
 * Maps known Tauri IPC command names to a stable default response. Individual
 * tests override any command via `ipc.override(cmd, handler)`.
 *
 * A command that is invoked but absent from this map (and not overridden) makes
 * the harness throw `[vitest] Unmocked Tauri IPC command: <cmd>` — this loud
 * failure is part of the contract and must not be bypassed. To add a default
 * response, add an entry here; to vary it per test, use `ipc.override`.
 */

export type IpcHandler = (args?: Record<string, unknown>, commandName?: string) => unknown

export const IPC_FIXTURES: Record<string, IpcHandler> = {
  // --- Tauri event system (shouldMockEvents handles listen/unlisten at the API
  //     level; included for completeness) ---
  'plugin:event|listen': (args) => args?.handler ?? null,
  'plugin:event|unlisten': () => null,

  // --- Logging (backend command lands in Phase A2) ---
  log_frontend: () => undefined,

  // --- Settings. Theme/accent persist fire-and-forget; the Settings page and
  //     startup theme hydration read these. Defaults are empty/no-op so the
  //     harness does not throw; override per-test for specific values. ---
  set_setting: () => undefined,
  get_all_settings: () => [],
  get_setting: () => null,
}
