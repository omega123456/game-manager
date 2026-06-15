import * as React from 'react'

import { type AccentKey, type ResolvedTheme, type ThemePreference } from '@/stores/ui-store'

export interface ThemeContextValue {
  /** User preference (light/dark/system). */
  theme: ThemePreference
  /** Theme actually applied to the document after resolving `system`. */
  resolvedTheme: ResolvedTheme
  accent: AccentKey
  setTheme: (theme: ThemePreference) => void
  setAccent: (accent: AccentKey) => void
}

export const ThemeContext = React.createContext<ThemeContextValue | null>(null)

/** Access the theme controls. Throws if used outside `ThemeProvider`. */
export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return ctx
}
