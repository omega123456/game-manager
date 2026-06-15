/**
 * Playwright fixtures for the settings domain.
 *
 * The web build (VITE_PLAYWRIGHT) has no Tauri backend, so settings reads resolve
 * to a deterministic empty set and writes are no-ops. This keeps the Settings
 * page screenshots stable (empty key fields → info-tone hints visible).
 */
import type { PlaywrightFixtureHandler } from './index'

export interface SettingRow {
  key: string
  value?: string | null
}

/** Default settings rows returned by `get_all_settings` in E2E. */
export const SETTINGS_ROWS: SettingRow[] = []

export const settingsFixtures: Record<string, PlaywrightFixtureHandler> = {
  get_all_settings: () => SETTINGS_ROWS,
  get_setting: () => null,
  set_setting: () => undefined,
}
