/**
 * Playwright / VITE_PLAYWRIGHT IPC mock router (Phase A1 skeleton).
 *
 * When the frontend is built with `VITE_PLAYWRIGHT=true`, `main.tsx` installs
 * this handler via `@tauri-apps/api/mocks` `mockIPC` so the web build can run in a
 * plain browser (no Tauri runtime) for E2E + screenshot tests.
 *
 * RULES (mirrored from the convention source):
 *  - Never embed fixture data or domain logic inline in the switch cases below.
 *    All fixture data lives in `src/tests/playwright-fixtures/` (one file per
 *    domain) and is wired through the registry in
 *    `src/tests/playwright-fixtures/index.ts`.
 *  - Every IPC command called from any UI flow covered by E2E must be handled here
 *    (step 7 of the "adding a command" checklist).
 */

import { resolvePlaywrightFixture } from '../tests/playwright-fixtures'

export function playwrightIpcMockHandler(cmd: string, args?: Record<string, unknown>): unknown {
  // Tauri event plumbing — handled by mockIPC's shouldMockEvents where needed.
  if (cmd === 'plugin:event|listen' || cmd === 'plugin:event|unlisten') {
    return null
  }

  return resolvePlaywrightFixture(cmd, args)
}
