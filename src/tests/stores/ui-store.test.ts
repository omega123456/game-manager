import { beforeEach, describe, expect, it } from 'vitest'

import { ACCENTS, useUiStore } from '@/stores/ui-store'

describe('ui-store', () => {
  beforeEach(() => {
    useUiStore.setState({
      theme: 'system',
      accent: 'default',
      activeOverlay: 'none',
      searchQuery: '',
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
    s.setSearchQuery('elden')

    const next = useUiStore.getState()
    expect(next.theme).toBe('dark')
    expect(next.accent).toBe('violet')
    expect(next.activeOverlay).toBe('detail')
    expect(next.searchQuery).toBe('elden')
  })
})
