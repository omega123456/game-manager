import { create } from 'zustand'

/** Theme preference. `system` follows the OS color-scheme. */
export type ThemePreference = 'light' | 'dark' | 'system'

/** Resolved theme actually applied to the document. */
export type ResolvedTheme = 'light' | 'dark'

/**
 * Accent options. `default` restores the palette's own primary; the rest
 * override --primary / --ring with the listed HSL triplet.
 */
export type AccentKey = 'default' | 'violet' | 'emerald' | 'amber' | 'rose' | 'sky'

export const ACCENTS: Record<AccentKey, { label: string; hsl: string | null }> = {
  default: { label: 'Default', hsl: null },
  violet: { label: 'Violet', hsl: '258 90% 66%' },
  emerald: { label: 'Emerald', hsl: '160 84% 39%' },
  amber: { label: 'Amber', hsl: '38 92% 50%' },
  rose: { label: 'Rose', hsl: '347 77% 50%' },
  sky: { label: 'Sky', hsl: '199 89% 48%' },
}

/** Active overlay surface. Overlays are state, not routes. */
export type ActiveOverlay = 'none' | 'detail' | 'wizard' | 'confirm'

export interface UiState {
  theme: ThemePreference
  accent: AccentKey
  activeOverlay: ActiveOverlay
  selectedGameId: number | null
  /** Library/global search query, driven by the TopBar search input. */
  searchQuery: string
  setTheme: (theme: ThemePreference) => void
  setAccent: (accent: AccentKey) => void
  setActiveOverlay: (overlay: ActiveOverlay) => void
  setSelectedGameId: (gameId: number | null) => void
  setSearchQuery: (query: string) => void
}

export const useUiStore = create<UiState>((set) => ({
  theme: 'system',
  accent: 'default',
  activeOverlay: 'none',
  selectedGameId: null,
  searchQuery: '',
  setTheme: (theme) => set({ theme }),
  setAccent: (accent) => set({ accent }),
  setActiveOverlay: (activeOverlay) => set({ activeOverlay }),
  setSelectedGameId: (selectedGameId) => set({ selectedGameId }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
}))
