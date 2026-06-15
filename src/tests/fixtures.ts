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
  'plugin:dialog|open': () => null,

  // --- Logging (backend command lands in Phase A2) ---
  log_frontend: () => undefined,

  // --- Settings. Theme/accent persist fire-and-forget; the Settings page and
  //     startup theme hydration read these. Defaults are empty/no-op so the
  //     harness does not throw; override per-test for specific values. ---
  set_setting: () => undefined,
  get_all_settings: () => [],
  get_setting: () => null,

  // --- Games. Phase B1 introduces the backend + wrappers; defaults keep the
  //     harness quiet until tests override specific flows. ---
  list_games: () => [],
  get_game: () => null,
  get_play_now_game: () => null,
  create_game: (args) => args?.input,
  update_game: (args) => ({ id: args?.id, ...(args?.input as object) }),
  delete_game: () => undefined,
  set_game_groups: (args) => args?.groupIds ?? [],
  set_game_scripts: (args) => args?.scriptIds ?? [],
  get_resolved_scripts: () => [],

  // --- Groups. Phase D1 introduces the backend + wrappers; defaults keep the
  //     harness quiet until tests override specific flows. ---
  list_groups: () => [],
  get_group: () => null,
  create_group: (args) => ({ scriptIds: [], gameIds: [], ...(args?.input as object) }),
  update_group: (args) => ({
    id: args?.id,
    scriptIds: [],
    gameIds: [],
    ...(args?.input as object),
  }),
  delete_group: () => undefined,
  set_group_scripts: (args) => args?.scriptIds ?? [],

  // --- Scripts. Phase C1 introduces the backend + wrappers; defaults keep the
  //     harness quiet until tests override specific flows. ---
  list_scripts: () => [],
  get_script: () => null,
  create_script: (args) => args?.input,
  update_script: (args) => ({ id: args?.id, ...(args?.input as object) }),
  delete_script: () => undefined,
  set_script_dependencies: (args) => args?.dependsOn ?? [],
  set_script_kind: (args) => ({ id: args?.id, kind: args?.kind }),

  // --- Launch. Phase E1 introduces the orchestrator + wrappers; defaults keep
  //     the harness quiet. Progress arrives via `launch://*` events (use
  //     `ipc.emit`); these commands themselves are fire-and-forget. ---
  launch_game: () => undefined,
  cancel_launch: () => false,

  // --- Art + metadata. Phase B3 adds the backend used by the future Add Game
  //     wizard. Defaults stay deterministic and cheap. ---
  search_art: () => [],
  fetch_metadata: (args) => ({
    canonicalName: String(args?.name ?? ''),
    source: 'input',
  }),
  cache_art_candidate: () => null,
}
