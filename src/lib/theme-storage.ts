import type { AccentKey, ThemePreference } from '@/stores/ui-store'
import { ACCENTS } from '@/stores/ui-store'

const THEME_KEY = 'gm.theme'
const ACCENT_KEY = 'gm.accent'

const THEME_VALUES: readonly ThemePreference[] = ['light', 'dark', 'system']

function safeGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // Storage unavailable (private mode / quota); fall back to in-memory only.
  }
}

/** Read the persisted theme preference, defaulting to `system`. */
export function readStoredTheme(): ThemePreference {
  const raw = safeGet(THEME_KEY)
  return THEME_VALUES.includes(raw as ThemePreference) ? (raw as ThemePreference) : 'system'
}

/** Read the persisted accent, defaulting to `default`. */
export function readStoredAccent(): AccentKey {
  const raw = safeGet(ACCENT_KEY)
  return raw && raw in ACCENTS ? (raw as AccentKey) : 'default'
}

/** Validate an arbitrary string as a `ThemePreference`, else `null`. */
export function parseThemePreference(raw: string | null | undefined): ThemePreference | null {
  return raw && THEME_VALUES.includes(raw as ThemePreference) ? (raw as ThemePreference) : null
}

/** Validate an arbitrary string as an `AccentKey`, else `null`. */
export function parseAccentKey(raw: string | null | undefined): AccentKey | null {
  return raw && raw in ACCENTS ? (raw as AccentKey) : null
}

export function writeStoredTheme(theme: ThemePreference): void {
  safeSet(THEME_KEY, theme)
}

export function writeStoredAccent(accent: AccentKey): void {
  safeSet(ACCENT_KEY, accent)
}
