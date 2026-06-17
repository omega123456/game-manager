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

/** Metadata mirroring the Tauri updater `check()` response when a release exists. */
const AVAILABLE_UPDATE_METADATA = {
  rid: 9001,
  currentVersion: '1.0.0',
  version: '2.0.0',
  date: '2026-06-17T00:00:00.000Z',
  body: 'Bug fixes and improvements.',
  rawJson: null,
}

/**
 * Resolve the updater check response from the `updateFixture` query param so a
 * single E2E run can exercise both the "no update" default and the
 * "update available" toast without touching the mock router.
 */
function getUpdateCheckResult(): unknown {
  if (typeof window === 'undefined') {
    return null
  }
  const [, search = ''] = window.location.hash.split('?')
  const params = new URLSearchParams(search)
  return params.get('updateFixture') === 'available' ? AVAILABLE_UPDATE_METADATA : null
}

export const settingsFixtures: Record<string, PlaywrightFixtureHandler> = {
  get_all_settings: () => SETTINGS_ROWS,
  get_setting: () => null,
  set_setting: () => undefined,
  'plugin:updater|check': () => getUpdateCheckResult(),
  'plugin:updater|download_and_install': () => null,
  'plugin:process|relaunch': () => null,
  'plugin:process|restart': () => null,
}
