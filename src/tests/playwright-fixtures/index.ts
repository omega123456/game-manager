/**
 * Playwright fixture registry.
 *
 * The `VITE_PLAYWRIGHT` IPC mock router (`src/lib/playwright-ipc-mock.ts`) looks
 * up command responses here. Add one file per domain in this directory (e.g.
 * `games.ts`, `scripts.ts`) and register its handlers in `FIXTURE_REGISTRY` so
 * fixture data can be looked up — and overridden per-test — without touching the
 * mock router or embedding data inline in switch cases.
 */

import { settingsFixtures } from './settings'
import { gamesFixtures } from './games'
import { scriptsFixtures } from './scripts'
import { artFixtures } from './art'
import { dialogFixtures } from './dialog'
import { groupsFixtures } from './groups'
import { launchFixtures } from './launch'
import { logsFixtures } from './logs'

export type PlaywrightFixtureHandler = (args?: Record<string, unknown>) => unknown

/**
 * Command name -> fixture handler. Empty in Phase A1; populated as domains land.
 */
export const FIXTURE_REGISTRY: Record<string, PlaywrightFixtureHandler> = {
  // Logging command (backend lands in Phase A2). Safe no-op for the web build.
  log_frontend: () => undefined,
  ...logsFixtures,
  ...dialogFixtures,
  ...artFixtures,
  ...gamesFixtures,
  ...groupsFixtures,
  ...scriptsFixtures,
  ...launchFixtures,
  // Settings domain (reads/writes) — registered from settings.ts.
  ...settingsFixtures,
}

/**
 * Resolve a command to its registered fixture response. Returns `undefined` for
 * unregistered commands so the web build degrades gracefully (E2E asserts on the
 * registered surface only).
 */
export function resolvePlaywrightFixture(cmd: string, args?: Record<string, unknown>): unknown {
  const handler = FIXTURE_REGISTRY[cmd]
  return handler ? handler(args) : undefined
}
