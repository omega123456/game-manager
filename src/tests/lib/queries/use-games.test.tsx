import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  gameDetailQueryKey,
  latestLaunchRunQueryKey,
  resolvedScriptsQueryKey,
  useCreateGameMutation,
  useDeleteGameMutation,
  useGameQuery,
  useGamesQuery,
  useLatestLaunchRunQuery,
  usePlayNowGameQuery,
  useResolvedScriptsQuery,
  useSetGameGroupsMutation,
  useSetGameScriptsMutation,
  useUpdateGameMutation,
} from '@/lib/queries/use-games'
import { useGroupsQuery } from '@/lib/queries/use-groups'
import { GAMES_QUERY_KEY, GROUPS_QUERY_KEY, PLAY_NOW_QUERY_KEY } from '@/lib/queries/query-keys'
import { useLaunchStore } from '@/stores/launch-store'
import { ipc } from '../../ipc-mock'

const GAME_ROW = {
  id: 1,
  name: 'Alan Wake 2',
  launchTarget: 'C:/Games/AlanWake2.exe',
  monitorMode: 'tree' as const,
  groupIds: [],
  scriptIds: [],
  createdAt: '2026-01-01T00:00:00Z',
  totalPlaytimeSeconds: 0,
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

beforeEach(() => {
  useLaunchStore.getState().reset()
})

describe('useGamesQuery', () => {
  it('loads the game library', async () => {
    ipc.override('list_games', () => [GAME_ROW])
    const { result } = renderHook(() => useGamesQuery(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([GAME_ROW])
  })
})

describe('useGameQuery', () => {
  it('loads a single game when an id is provided', async () => {
    ipc.override('get_game', (args) => ({ ...GAME_ROW, id: args?.id }))
    const { result } = renderHook(() => useGameQuery(9), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatchObject({ id: 9 })
  })

  it('stays idle without an id', () => {
    const { result } = renderHook(() => useGameQuery(null), { wrapper: wrapper() })
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useResolvedScriptsQuery', () => {
  it('loads resolved scripts when an id is provided', async () => {
    ipc.override('get_resolved_scripts', () => [{ scriptId: 3, name: 'HDR', phase: 'before' }])
    const { result } = renderHook(() => useResolvedScriptsQuery(3), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ scriptId: 3, name: 'HDR', phase: 'before' }])
  })
})

describe('useLatestLaunchRunQuery', () => {
  it('loads the latest launch run when an id is provided', async () => {
    ipc.override('get_latest_launch_run', () => ({
      id: 22,
      gameId: 3,
      playSessionId: 5,
      status: 'active',
      startedAt: '2026-06-19T10:00:00Z',
      failureCount: 0,
      scriptRecords: [
        {
          id: 1,
          launchRunId: 22,
          scriptId: 11,
          name: 'HDR Toggle',
          phase: 'before',
          provenance: 'global',
          order: 1,
          priority: 8,
          requiredUtilityNames: ['SaveLib'],
          status: 'running',
          startedAt: '2026-06-19T10:00:02Z',
        },
      ],
    }))
    const { result } = renderHook(() => useLatestLaunchRunQuery(3), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({
      id: 22,
      gameId: 3,
      playSessionId: 5,
      status: 'active',
      startedAt: '2026-06-19T10:00:00Z',
      failureCount: 0,
      scriptRecords: [
        {
          id: 1,
          launchRunId: 22,
          scriptId: 11,
          name: 'HDR Toggle',
          phase: 'before',
          provenance: 'global',
          order: 1,
          priority: 8,
          requiredUtilityNames: ['SaveLib'],
          status: 'running',
          startedAt: '2026-06-19T10:00:02Z',
        },
      ],
    })
    expect(ipc.calls('get_latest_launch_run')).toEqual([{ gameId: 3 }])
  })

  it('stays idle without an id', () => {
    const { result } = renderHook(() => useLatestLaunchRunQuery(undefined), { wrapper: wrapper() })
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
  })

  it('hides a previous retained run while a fresh launch for the same game is active', async () => {
    ipc.override('get_latest_launch_run', () => ({
      id: 9,
      gameId: 3,
      status: 'completed',
      startedAt: '2026-06-19T10:00:00Z',
      endedAt: '2026-06-19T10:05:00Z',
      failureCount: 0,
      scriptRecords: [],
    }))
    useLaunchStore.getState().startPreparing(3, 'Alan Wake 2')

    const { result } = renderHook(() => useLatestLaunchRunQuery(3), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })
})

describe('usePlayNowGameQuery', () => {
  it('loads the current play-now target', async () => {
    ipc.override('get_play_now_game', () => GAME_ROW)
    const { result } = renderHook(() => usePlayNowGameQuery(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(GAME_ROW)
  })
})

describe('game mutations', () => {
  it('creates a game', async () => {
    ipc.override('create_game', (args) => ({ ...GAME_ROW, ...(args?.input as object) }))
    const { result } = renderHook(() => useCreateGameMutation(), { wrapper: wrapper() })
    await result.current.mutateAsync({
      name: 'Alan Wake 2',
      launchTarget: 'C:/Games/AlanWake2.exe',
      monitorMode: 'tree',
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ipc.calls('create_game')).toHaveLength(1)
  })

  it('updates a game', async () => {
    ipc.override('update_game', (args) => ({
      ...GAME_ROW,
      id: args?.id,
      ...((args?.input as object) ?? {}),
    }))
    const { result } = renderHook(() => useUpdateGameMutation(), { wrapper: wrapper() })
    await result.current.mutateAsync({
      id: 3,
      input: {
        name: 'Alan Wake Remastered',
        launchTarget: 'C:/Games/AW.exe',
        monitorMode: 'named',
        monitorProcessName: 'aw.exe',
      },
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ipc.calls('update_game')).toHaveLength(1)
  })

  it('deletes a game', async () => {
    const { result } = renderHook(() => useDeleteGameMutation(), { wrapper: wrapper() })
    await result.current.mutateAsync(3)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ipc.calls('delete_game')).toEqual([{ id: 3 }])
  })

  it('replaces group ids', async () => {
    ipc.override('set_game_groups', () => [1, 2])
    const { result } = renderHook(() => useSetGameGroupsMutation(), { wrapper: wrapper() })
    await result.current.mutateAsync({ gameId: 4, groupIds: [2, 1] })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ipc.calls('set_game_groups')).toEqual([{ gameId: 4, groupIds: [2, 1] }])
  })

  it('updates cached game data immediately and refreshes groups after membership changes', async () => {
    let groupsVersion = 0
    ipc.override('set_game_groups', () => [2, 1])
    ipc.override('list_groups', () => {
      groupsVersion += 1
      return [{ id: 9, name: 'HDR', description: null, scriptIds: [], gameIds: [1, 2] }]
    })

    const { client, Wrapper } = createWrapper()
    client.setQueryData(GAMES_QUERY_KEY, [GAME_ROW])
    client.setQueryData(gameDetailQueryKey(1), GAME_ROW)
    client.setQueryData(GROUPS_QUERY_KEY, [
      { id: 9, name: 'HDR', description: null, scriptIds: [], gameIds: [1] },
    ])

    const groupsQuery = renderHook(() => useGroupsQuery(), { wrapper: Wrapper })
    const mutation = renderHook(() => useSetGameGroupsMutation(), { wrapper: Wrapper })

    await mutation.result.current.mutateAsync({ gameId: 1, groupIds: [2, 1] })

    expect(client.getQueryData(GAMES_QUERY_KEY)).toEqual([{ ...GAME_ROW, groupIds: [2, 1] }])
    expect(client.getQueryData(gameDetailQueryKey(1))).toEqual({ ...GAME_ROW, groupIds: [2, 1] })
    await waitFor(() => expect(groupsVersion).toBeGreaterThan(0))
    await waitFor(() =>
      expect(client.getQueryData(GROUPS_QUERY_KEY)).toEqual([
        { id: 9, name: 'HDR', description: null, scriptIds: [], gameIds: [1, 2] },
      ])
    )
    groupsQuery.unmount()
  })

  it('replaces script ids', async () => {
    ipc.override('set_game_scripts', () => [8])
    const { result } = renderHook(() => useSetGameScriptsMutation(), { wrapper: wrapper() })
    await result.current.mutateAsync({ gameId: 4, scriptIds: [8] })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ipc.calls('set_game_scripts')).toEqual([{ gameId: 4, scriptIds: [8] }])
  })

  it('updates cached scripts immediately for the edited game', async () => {
    ipc.override('set_game_scripts', () => [8])
    const { client, Wrapper } = createWrapper()
    client.setQueryData(GAMES_QUERY_KEY, [GAME_ROW])
    client.setQueryData(gameDetailQueryKey(1), GAME_ROW)
    client.setQueryData(resolvedScriptsQueryKey(1), [])
    client.setQueryData(latestLaunchRunQueryKey(1), null)

    const mutation = renderHook(() => useSetGameScriptsMutation(), { wrapper: Wrapper })
    await mutation.result.current.mutateAsync({ gameId: 1, scriptIds: [8] })

    expect(client.getQueryData(GAMES_QUERY_KEY)).toEqual([{ ...GAME_ROW, scriptIds: [8] }])
    expect(client.getQueryData(gameDetailQueryKey(1))).toEqual({ ...GAME_ROW, scriptIds: [8] })
    expect(client.getQueryState(resolvedScriptsQueryKey(1))?.isInvalidated).toBe(true)
    expect(client.getQueryState(latestLaunchRunQueryKey(1))?.isInvalidated).toBe(true)
  })

  it('invalidates the play-now cache on game delete', async () => {
    const { client, Wrapper } = createWrapper()
    client.setQueryData(PLAY_NOW_QUERY_KEY, GAME_ROW)
    let playNowCalls = 0
    ipc.override('get_play_now_game', () => {
      playNowCalls += 1
      return GAME_ROW
    })

    const playNowQuery = renderHook(() => usePlayNowGameQuery(), { wrapper: Wrapper })
    await waitFor(() => expect(playNowCalls).toBe(1))
    const mutation = renderHook(() => useDeleteGameMutation(), { wrapper: Wrapper })
    await mutation.result.current.mutateAsync(1)

    await waitFor(() => expect(playNowCalls).toBeGreaterThan(1))
    playNowQuery.unmount()
  })

  it('refreshes the groups cache on game delete so cascaded membership drops', async () => {
    const { Wrapper } = createWrapper()
    let groupCalls = 0
    ipc.override('list_groups', () => {
      groupCalls += 1
      return []
    })

    const groupsQuery = renderHook(() => useGroupsQuery(), { wrapper: Wrapper })
    await waitFor(() => expect(groupCalls).toBe(1))
    const mutation = renderHook(() => useDeleteGameMutation(), { wrapper: Wrapper })
    await mutation.result.current.mutateAsync(1)

    await waitFor(() => expect(groupCalls).toBeGreaterThan(1))
    groupsQuery.unmount()
  })

  it('rolls back optimistic group ids when set_game_groups fails', async () => {
    ipc.override('set_game_groups', () => {
      throw new Error('network down')
    })

    const { client, Wrapper } = createWrapper()
    const previousGame = { ...GAME_ROW, groupIds: [5] }
    client.setQueryData(GAMES_QUERY_KEY, [previousGame])
    client.setQueryData(gameDetailQueryKey(1), previousGame)

    const mutation = renderHook(() => useSetGameGroupsMutation(), { wrapper: Wrapper })

    await expect(
      mutation.result.current.mutateAsync({ gameId: 1, groupIds: [2, 1] })
    ).rejects.toThrow('network down')

    expect(client.getQueryData(GAMES_QUERY_KEY)).toEqual([previousGame])
    expect(client.getQueryData(gameDetailQueryKey(1))).toEqual(previousGame)
  })

  it('rolls back optimistic script ids when set_game_scripts fails', async () => {
    ipc.override('set_game_scripts', () => {
      throw new Error('save failed')
    })

    const { client, Wrapper } = createWrapper()
    const previousGame = { ...GAME_ROW, scriptIds: [3] }
    client.setQueryData(GAMES_QUERY_KEY, [previousGame])
    client.setQueryData(gameDetailQueryKey(1), previousGame)

    const mutation = renderHook(() => useSetGameScriptsMutation(), { wrapper: Wrapper })

    await expect(
      mutation.result.current.mutateAsync({ gameId: 1, scriptIds: [8] })
    ).rejects.toThrow('save failed')

    expect(client.getQueryData(GAMES_QUERY_KEY)).toEqual([previousGame])
    expect(client.getQueryData(gameDetailQueryKey(1))).toEqual(previousGame)
  })
})
