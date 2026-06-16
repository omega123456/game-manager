import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  groupDetailQueryKey,
  useCreateGroupMutation,
  useDeleteGroupMutation,
  useGroupQuery,
  useGroupsQuery,
  useSetGroupGamesMutation,
  useSetGroupScriptsMutation,
  useUpdateGroupMutation,
} from '@/lib/queries/use-groups'
import { useGamesQuery } from '@/lib/queries/use-games'
import { GAMES_QUERY_KEY, GROUPS_QUERY_KEY } from '@/lib/queries/query-keys'
import type { Group } from '@/types/domain'

import { ipc } from '../../ipc-mock'

const GROUP_ROW: Group = {
  id: 1,
  name: 'HDR Games',
  description: 'Shared HDR setup',
  scriptIds: [7],
  gameIds: [2],
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return {
    client,
    Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>
    },
  }
}

describe('useGroupsQuery', () => {
  it('loads the groups list', async () => {
    ipc.override('list_groups', () => [GROUP_ROW])
    const { result } = renderHook(() => useGroupsQuery(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([GROUP_ROW])
  })
})

describe('useGroupQuery', () => {
  it('loads a single group when an id is provided', async () => {
    ipc.override('get_group', (args) => ({ ...GROUP_ROW, id: args?.id }))
    const { result } = renderHook(() => useGroupQuery(9), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatchObject({ id: 9 })
  })

  it('stays idle without an id', () => {
    const { result } = renderHook(() => useGroupQuery(null), { wrapper: wrapper() })
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('group mutations', () => {
  it('creates a group', async () => {
    ipc.override('create_group', (args) => ({ ...GROUP_ROW, ...(args?.input as object) }))
    const { client, Wrapper } = createWrapper()
    client.setQueryData(GROUPS_QUERY_KEY, [])
    const { result } = renderHook(() => useCreateGroupMutation(), { wrapper: Wrapper })
    const created = await result.current.mutateAsync({
      name: 'HDR Games',
      description: 'Shared HDR setup',
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ipc.calls('create_group')).toHaveLength(1)
    expect(client.getQueryData(GROUPS_QUERY_KEY)).toEqual([created])
    expect(client.getQueryData(groupDetailQueryKey(created.id))).toEqual(created)
  })

  it('updates a group', async () => {
    ipc.override('update_group', (args) => ({
      ...GROUP_ROW,
      id: args?.id,
      ...((args?.input as object) ?? {}),
    }))
    const { result } = renderHook(() => useUpdateGroupMutation(), { wrapper: wrapper() })
    await result.current.mutateAsync({
      id: 3,
      input: {
        name: 'Deck Verified',
        description: 'Portable-friendly tweaks',
      },
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ipc.calls('update_group')).toHaveLength(1)
  })

  it('refreshes dependent game consumers after a group rename', async () => {
    let gamesVersion = 0
    ipc.override('update_group', (args) => ({
      ...GROUP_ROW,
      id: args?.id,
      ...((args?.input as object) ?? {}),
    }))
    ipc.override('list_games', () => {
      gamesVersion += 1
      return [
        {
          id: 2,
          name: 'Alan Wake 2',
          launchTarget: 'C:/Games/AlanWake2.exe',
          monitorMode: 'tree',
          groupIds: [1],
          scriptIds: [8],
          createdAt: '2026-01-01T00:00:00Z',
          totalPlaytimeSeconds: 0,
        },
      ]
    })

    const { client, Wrapper } = createWrapper()
    client.setQueryData(GROUPS_QUERY_KEY, [GROUP_ROW])
    client.setQueryData(groupDetailQueryKey(1), GROUP_ROW)
    client.setQueryData(GAMES_QUERY_KEY, [])

    const gamesQuery = renderHook(() => useGamesQuery(), { wrapper: Wrapper })
    const mutation = renderHook(() => useUpdateGroupMutation(), { wrapper: Wrapper })

    await mutation.result.current.mutateAsync({
      id: 1,
      input: {
        name: 'Deck Verified',
        description: 'Portable-friendly tweaks',
      },
    })

    await waitFor(() => expect(gamesVersion).toBeGreaterThan(0))
    gamesQuery.unmount()
  })

  it('deletes a group', async () => {
    const { result } = renderHook(() => useDeleteGroupMutation(), { wrapper: wrapper() })
    await result.current.mutateAsync(3)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ipc.calls('delete_group')).toEqual([{ id: 3 }])
  })

  it('replaces script ids', async () => {
    ipc.override('set_group_scripts', () => [8])
    const { result } = renderHook(() => useSetGroupScriptsMutation(), { wrapper: wrapper() })
    await result.current.mutateAsync({ groupId: 4, scriptIds: [8] })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ipc.calls('set_group_scripts')).toEqual([{ groupId: 4, scriptIds: [8] }])
  })

  it('updates cached group scripts immediately and refreshes dependent game data', async () => {
    let gamesVersion = 0
    ipc.override('set_group_scripts', () => [8])
    ipc.override('list_games', () => {
      gamesVersion += 1
      return [
        {
          id: 2,
          name: 'Alan Wake 2',
          launchTarget: 'C:/Games/AlanWake2.exe',
          monitorMode: 'tree',
          groupIds: [1],
          scriptIds: [8],
          createdAt: '2026-01-01T00:00:00Z',
          totalPlaytimeSeconds: 0,
        },
      ]
    })

    const { client, Wrapper } = createWrapper()
    client.setQueryData(GROUPS_QUERY_KEY, [GROUP_ROW])
    client.setQueryData(groupDetailQueryKey(1), GROUP_ROW)
    client.setQueryData(GAMES_QUERY_KEY, [])

    const gamesQuery = renderHook(() => useGamesQuery(), { wrapper: Wrapper })
    const mutation = renderHook(() => useSetGroupScriptsMutation(), { wrapper: Wrapper })

    await mutation.result.current.mutateAsync({ groupId: 1, scriptIds: [8] })

    expect(client.getQueryData(GROUPS_QUERY_KEY)).toEqual([{ ...GROUP_ROW, scriptIds: [8] }])
    expect(client.getQueryData(groupDetailQueryKey(1))).toEqual({ ...GROUP_ROW, scriptIds: [8] })
    await waitFor(() => expect(gamesVersion).toBeGreaterThan(0))
    gamesQuery.unmount()
  })

  it('rolls back optimistic script ids when set_group_scripts fails', async () => {
    ipc.override('set_group_scripts', () => {
      throw new Error('save failed')
    })

    const { client, Wrapper } = createWrapper()
    client.setQueryData(GROUPS_QUERY_KEY, [GROUP_ROW])
    client.setQueryData(groupDetailQueryKey(1), GROUP_ROW)

    const mutation = renderHook(() => useSetGroupScriptsMutation(), { wrapper: Wrapper })

    await expect(
      mutation.result.current.mutateAsync({ groupId: 1, scriptIds: [8] })
    ).rejects.toThrow('save failed')

    expect(client.getQueryData(GROUPS_QUERY_KEY)).toEqual([GROUP_ROW])
    expect(client.getQueryData(groupDetailQueryKey(1))).toEqual(GROUP_ROW)
  })

  it('updates cached group games immediately and refreshes dependent game data', async () => {
    let gamesVersion = 0
    ipc.override('set_group_games', () => [2, 5])
    ipc.override('list_games', () => {
      gamesVersion += 1
      return []
    })

    const { client, Wrapper } = createWrapper()
    client.setQueryData(GROUPS_QUERY_KEY, [GROUP_ROW])
    client.setQueryData(groupDetailQueryKey(1), GROUP_ROW)
    client.setQueryData(GAMES_QUERY_KEY, [])

    const gamesQuery = renderHook(() => useGamesQuery(), { wrapper: Wrapper })
    const mutation = renderHook(() => useSetGroupGamesMutation(), { wrapper: Wrapper })

    await mutation.result.current.mutateAsync({ groupId: 1, gameIds: [2, 5] })

    expect(client.getQueryData(GROUPS_QUERY_KEY)).toEqual([{ ...GROUP_ROW, gameIds: [2, 5] }])
    expect(client.getQueryData(groupDetailQueryKey(1))).toEqual({ ...GROUP_ROW, gameIds: [2, 5] })
    await waitFor(() => expect(gamesVersion).toBeGreaterThan(0))
    gamesQuery.unmount()
  })

  it('rolls back optimistic game ids when set_group_games fails', async () => {
    ipc.override('set_group_games', () => {
      throw new Error('save failed')
    })

    const { client, Wrapper } = createWrapper()
    client.setQueryData(GROUPS_QUERY_KEY, [GROUP_ROW])
    client.setQueryData(groupDetailQueryKey(1), GROUP_ROW)

    const mutation = renderHook(() => useSetGroupGamesMutation(), { wrapper: Wrapper })

    await expect(
      mutation.result.current.mutateAsync({ groupId: 1, gameIds: [2, 5] })
    ).rejects.toThrow('save failed')

    expect(client.getQueryData(GROUPS_QUERY_KEY)).toEqual([GROUP_ROW])
    expect(client.getQueryData(groupDetailQueryKey(1))).toEqual(GROUP_ROW)
  })
})
