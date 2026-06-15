import type { PlaywrightFixtureHandler } from './index'

/**
 * Launch domain fixtures for the `VITE_PLAYWRIGHT` web build. The commands are
 * fire-and-forget; lifecycle progress (the `launch://*` events) is driven by the
 * lifecycle UI tests in Phase E2, not synthesized here.
 */
export const launchFixtures: Record<string, PlaywrightFixtureHandler> = {
  launch_game: () => undefined,
  cancel_launch: () => false,
}
