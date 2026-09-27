import { beforeEach, describe, expect, it } from 'vitest'

import { ACCENTS, useUiStore } from '@/stores/ui-store'

describe('ui-store', () => {
  beforeEach(() => {
    useUiStore.setState({
      theme: 'system',
      accent: 'default',
      activeOverlay: 'none',
      selectedGameId: null,
      searchQuery: '',
      startupInstallRecheckStarted: false,
    })
  })

  it('exposes the documented accent palette', () => {
    expect(ACCENTS.default.hsl).toBeNull()
    expect(ACCENTS.violet.hsl).toBeTypeOf('string')
    expect(Object.keys(ACCENTS)).toContain('emerald')
  })

  it('updates theme, accent, overlay, and search', () => {
    const s = useUiStore.getState()
    s.setTheme('dark')
    s.setAccent('violet')
    s.setActiveOverlay('detail')
    s.setSelectedGameId(42)
    s.setSearchQuery('elden')

    const next = useUiStore.getState()
    expect(next.theme).toBe('dark')
    expect(next.accent).toBe('violet')
    expect(next.activeOverlay).toBe('detail')
    expect(next.selectedGameId).toBe(42)
    expect(next.searchQuery).toBe('elden')
  })

  it('marks the startup install recheck as started', () => {
    expect(useUiStore.getState().startupInstallRecheckStarted).toBe(false)
    useUiStore.getState().markStartupInstallRecheckStarted()
    expect(useUiStore.getState().startupInstallRecheckStarted).toBe(true)
  })
})
