import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider, useTheme } from '@/components/theme/theme-provider'
import { useUiStore } from '@/stores/ui-store'
import { ipc } from '../../ipc-mock'

interface FakeMql {
  matches: boolean
  fire: (matches: boolean) => void
}

function installMatchMedia(initialDark: boolean): FakeMql {
  let listener: ((e: MediaQueryListEvent) => void) | null = null
  const fake: FakeMql = {
    matches: initialDark,
    fire: (matches) => {
      fake.matches = matches
      listener?.({ matches } as MediaQueryListEvent)
    },
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return fake.matches
      },
      media: '(prefers-color-scheme: dark)',
      addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
        listener = cb
      },
      removeEventListener: () => {
        listener = null
      },
    }))
  )
  return fake
}

function resetStore(): void {
  useUiStore.setState({
    theme: 'system',
    accent: 'default',
    activeOverlay: 'none',
    searchQuery: '',
  })
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    resetStore()
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-accent')
    document.documentElement.style.removeProperty('--primary')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves system preference to dark', async () => {
    installMatchMedia(true)
    render(
      <ThemeProvider>
        <span>child</span>
      </ThemeProvider>
    )
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'))
  })

  it('resolves system preference to light', async () => {
    installMatchMedia(false)
    render(<ThemeProvider>x</ThemeProvider>)
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'))
  })

  it('reacts to OS color-scheme changes while in system mode', async () => {
    const mql = installMatchMedia(false)
    render(<ThemeProvider>x</ThemeProvider>)
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'))
    act(() => mql.fire(true))
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'))
  })

  it('explicit theme overrides the system preference and persists', async () => {
    installMatchMedia(true)
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider })
    act(() => result.current.setTheme('light'))
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'))
    expect(localStorage.getItem('gm.theme')).toBe('light')
    expect(result.current.theme).toBe('light')
  })

  it('applies and clears accent overrides', async () => {
    installMatchMedia(false)
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider })

    act(() => result.current.setAccent('violet'))
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--primary')).not.toBe('')
    )
    expect(document.documentElement.getAttribute('data-accent')).toBe('violet')
    expect(localStorage.getItem('gm.accent')).toBe('violet')

    act(() => result.current.setAccent('default'))
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')
    )
  })

  it('hydrates from persisted preferences on mount', async () => {
    localStorage.setItem('gm.theme', 'dark')
    localStorage.setItem('gm.accent', 'emerald')
    installMatchMedia(false)
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider })
    await waitFor(() => expect(result.current.theme).toBe('dark'))
    expect(result.current.accent).toBe('emerald')
  })

  it('hydrates theme and accent from the backend settings (source of truth)', async () => {
    installMatchMedia(false)
    ipc.override('get_all_settings', () => [
      { key: 'theme', value: 'dark' },
      { key: 'accent', value: 'sky' },
    ])
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider })
    await waitFor(() => expect(result.current.theme).toBe('dark'))
    expect(result.current.accent).toBe('sky')
    expect(localStorage.getItem('gm.theme')).toBe('dark')
    expect(localStorage.getItem('gm.accent')).toBe('sky')
  })

  it('ignores invalid backend values and keeps the local fallback', async () => {
    installMatchMedia(false)
    localStorage.setItem('gm.theme', 'light')
    ipc.override('get_all_settings', () => [
      { key: 'theme', value: 'neon' },
      { key: 'accent', value: 'bogus' },
    ])
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider })
    await waitFor(() => expect(result.current.theme).toBe('light'))
    expect(result.current.accent).toBe('default')
  })

  it('logs and keeps the local fallback when backend hydration fails', async () => {
    installMatchMedia(false)
    ipc.override('get_all_settings', () => {
      throw new Error('ipc unavailable')
    })
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider })
    await waitFor(() => expect(ipc.calls('log_frontend').length).toBeGreaterThan(0))
    expect(result.current.theme).toBe('system')
  })

  it('throws when useTheme is used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<UseThemeProbe />)).toThrow('useTheme must be used within a ThemeProvider')
    spy.mockRestore()
  })
})

function UseThemeProbe(): React.JSX.Element {
  useTheme()
  return <span>probe</span>
}

describe('ThemeProvider without matchMedia', () => {
  beforeEach(() => resetStore())
  it('falls back to light when matchMedia is unavailable', async () => {
    vi.stubGlobal('matchMedia', undefined)
    render(<ThemeProvider>x</ThemeProvider>)
    await waitFor(() => expect(screen.getByText('x')).toBeInTheDocument())
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    vi.unstubAllGlobals()
  })
})
