import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  useCreateScriptMutation,
  useDeleteScriptMutation,
  useScriptQuery,
  useScriptsQuery,
  useSetScriptDependenciesMutation,
  useSetScriptKindMutation,
  useUpdateScriptMutation,
} from '@/lib/queries/use-scripts'
import { useGamesQuery } from '@/lib/queries/use-games'
import { useGroupsQuery } from '@/lib/queries/use-groups'
import type { Script } from '@/types/domain'

import { ipc } from '../../ipc-mock'

const SCRIPT_ROW: Script = {
  id: 1,
  name: 'Auto-Save',
  kind: 'normal',
  priority: 7,
  beforeLaunch: { mode: 'inline', inline: 'Write-Host hi', interpreter: 'powershell' },
  afterLaunch: { mode: 'none' },
  onExit: { mode: 'none' },
  snippet: { mode: 'none' },
  createdAt: '2026-01-01T00:00:00Z',
  requires: [],
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useScriptsQuery', () => {
  it('loads the script list', async () => {
    ipc.override('list_scripts', () => [SCRIPT_ROW])
    const { result } = renderHook(() => useScriptsQuery(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([SCRIPT_ROW])
  })
})

describe('useScriptQuery', () => {
  it('loads a single script when an id is provided', async () => {
    ipc.override('get_script', (args) => ({ ...SCRIPT_ROW, id: args?.id }))
    const { result } = renderHook(() => useScriptQuery(9), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatchObject({ id: 9 })
  })

  it('stays idle without an id', () => {
    const { result } = renderHook(() => useScriptQuery(null), { wrapper: wrapper() })
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('script mutations', () => {
  it('creates a script', async () => {
    ipc.override('create_script', (args) => ({ ...SCRIPT_ROW, ...(args?.input as object) }))
    const { result } = renderHook(() => useCreateScriptMutation(), { wrapper: wrapper() })
    await result.current.mutateAsync({ name: 'Auto-Save', kind: 'normal', priority: 7 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ipc.calls('create_script')).toHaveLength(1)
  })

  it('updates a script', async () => {
    ipc.override('update_script', (args) => ({
      ...SCRIPT_ROW,
      id: args?.id,
      ...((args?.input as object) ?? {}),
    }))
    const { result } = renderHook(() => useUpdateScriptMutation(), { wrapper: wrapper() })
    await result.current.mutateAsync({
      id: 3,
      input: { name: 'Renamed', kind: 'global', priority: 4 },
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ipc.calls('update_script')).toHaveLength(1)
  })

  it('deletes a script', async () => {
    const { result } = renderHook(() => useDeleteScriptMutation(), { wrapper: wrapper() })
    await result.current.mutateAsync(3)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ipc.calls('delete_script')).toEqual([{ id: 3 }])
  })

  it('refreshes games and groups on script delete so cascaded assignments drop', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    let gameCalls = 0
    let groupCalls = 0
    ipc.override('list_games', () => {
      gameCalls += 1
      return []
    })
    ipc.override('list_groups', () => {
      groupCalls += 1
      return []
    })

    const consumers = renderHook(
      () => {
        useGamesQuery()
        useGroupsQuery()
      },
      { wrapper: Wrapper }
    )
    await waitFor(() => expect(gameCalls).toBe(1))
    await waitFor(() => expect(groupCalls).toBe(1))

    const mutation = renderHook(() => useDeleteScriptMutation(), { wrapper: Wrapper })
    await mutation.result.current.mutateAsync(3)

    await waitFor(() => expect(gameCalls).toBeGreaterThan(1))
    await waitFor(() => expect(groupCalls).toBeGreaterThan(1))
    consumers.unmount()
  })

  it('sets dependencies', async () => {
    ipc.override('set_script_dependencies', () => [3, 4])
    const { result } = renderHook(() => useSetScriptDependenciesMutation(), { wrapper: wrapper() })
    await result.current.mutateAsync({ scriptId: 2, dependsOn: [3, 4] })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ipc.calls('set_script_dependencies')).toEqual([{ scriptId: 2, dependsOn: [3, 4] }])
  })

  it('sets the kind', async () => {
    ipc.override('set_script_kind', (args) => ({ ...SCRIPT_ROW, id: args?.id, kind: args?.kind }))
    const { result } = renderHook(() => useSetScriptKindMutation(), { wrapper: wrapper() })
    await result.current.mutateAsync({ id: 1, kind: 'global' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ipc.calls('set_script_kind')).toEqual([{ id: 1, kind: 'global' }])
  })
})
