import * as React from 'react'

import {
  ACCENTS,
  useUiStore,
  type AccentKey,
  type ResolvedTheme,
  type ThemePreference,
} from '@/stores/ui-store'
import { getAllSettings, setSettingFireAndForget } from '@/lib/ipc/settings-commands'
import { logFrontend } from '@/lib/app-log-commands'
import {
  parseAccentKey,
  parseThemePreference,
  readStoredAccent,
  readStoredTheme,
  writeStoredAccent,
  writeStoredTheme,
} from '@/lib/theme-storage'
import { ThemeContext, type ThemeContextValue } from '@/components/theme/theme-context'

const SYSTEM_QUERY = '(prefers-color-scheme: dark)'

function systemPrefersDark(): boolean {
  return globalThis.matchMedia?.(SYSTEM_QUERY).matches ?? false
}

function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') {
    return systemDark ? 'dark' : 'light'
  }
  return preference
}

function applyAccent(accent: AccentKey): void {
  const root = document.documentElement
  const { hsl } = ACCENTS[accent]
  if (hsl) {
    root.style.setProperty('--primary', hsl)
    root.style.setProperty('--ring', hsl)
  } else {
    // Restore the palette default (defined per-theme as --primary-default).
    root.style.removeProperty('--primary')
    root.style.removeProperty('--ring')
  }
  root.setAttribute('data-accent', accent)
}

export interface ThemeProviderProps {
  children: React.ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps): React.JSX.Element {
  const theme = useUiStore((s) => s.theme)
  const accent = useUiStore((s) => s.accent)
  const setThemeState = useUiStore((s) => s.setTheme)
  const setAccentState = useUiStore((s) => s.setAccent)

  const [systemDark, setSystemDark] = React.useState<boolean>(systemPrefersDark)

  // Hydrate from persisted preferences once on mount. The localStorage fallback
  // is applied synchronously (no flash), then the backend `settings` table — the
  // source of truth — is read asynchronously and seeded if it differs. Failures
  // (e.g. IPC unavailable) are non-blocking: the localStorage values stand.
  React.useEffect(() => {
    const initialTheme = readStoredTheme()
    const initialAccent = readStoredAccent()
    setThemeState(initialTheme)
    setAccentState(initialAccent)

    let cancelled = false
    void getAllSettings()
      .then((rows) => {
        if (cancelled) return
        const store = useUiStore.getState()
        const map = new Map(rows.map((row) => [row.key, row.value ?? '']))
        // Only seed from the backend if the user hasn't changed the value while
        // the read was in flight (store still holds the value we hydrated with).
        const theme = parseThemePreference(map.get('theme'))
        if (theme && store.theme === initialTheme) {
          setThemeState(theme)
          writeStoredTheme(theme)
        }
        const accent = parseAccentKey(map.get('accent'))
        if (accent && store.accent === initialAccent) {
          setAccentState(accent)
          writeStoredAccent(accent)
        }
      })
      .catch((err: unknown) => {
        logFrontend('debug', 'theme hydration from backend failed', {
          category: 'settings',
          details: String(err),
        })
      })

    return () => {
      cancelled = true
    }
  }, [setThemeState, setAccentState])

  // Track OS color-scheme changes while in `system` mode.
  React.useEffect(() => {
    const mql = globalThis.matchMedia?.(SYSTEM_QUERY)
    if (!mql) return
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const resolvedTheme = resolveTheme(theme, systemDark)

  // Apply the resolved theme to the document.
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme)
  }, [resolvedTheme])

  // Apply accent overrides whenever the accent changes.
  React.useEffect(() => {
    applyAccent(accent)
  }, [accent])

  const setTheme = React.useCallback(
    (next: ThemePreference) => {
      setThemeState(next)
      writeStoredTheme(next)
      setSettingFireAndForget('theme', next)
    },
    [setThemeState]
  )

  const setAccent = React.useCallback(
    (next: AccentKey) => {
      setAccentState(next)
      writeStoredAccent(next)
      setSettingFireAndForget('accent', next)
    },
    [setAccentState]
  )

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, accent, setTheme, setAccent }),
    [theme, resolvedTheme, accent, setTheme, setAccent]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
