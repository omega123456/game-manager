import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useSetSettingMutation, useSettingsQuery } from '@/lib/queries/use-settings'
import { ipc } from '../../ipc-mock'

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useSettingsQuery', () => {
  it('maps rows to a key->value record, coalescing null to empty string', async () => {
    ipc.override('get_all_settings', () => [
      { key: 'theme', value: 'dark' },
      { key: 'steam_api_key', value: null },
    ])
    const { result } = renderHook(() => useSettingsQuery(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ theme: 'dark', steam_api_key: '' })
  })
})

describe('useSetSettingMutation', () => {
  it('persists via set_setting and invalidates the settings cache', async () => {
    const { result } = renderHook(() => useSetSettingMutation(), { wrapper: wrapper() })
    await result.current.mutateAsync({ key: 'theme', value: 'light' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ipc.calls('set_setting')).toContainEqual({ key: 'theme', value: 'light' })
  })

  it('surfaces a backend rejection', async () => {
    ipc.override('set_setting', () => {
      throw new Error('save failed')
    })
    const { result } = renderHook(() => useSetSettingMutation(), { wrapper: wrapper() })
    await expect(result.current.mutateAsync({ key: 'theme', value: 'light' })).rejects.toThrow(
      'save failed'
    )
  })
})
