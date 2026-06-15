import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  useCreateGameMutation,
  useDeleteGameMutation,
  useGameQuery,
  useGamesQuery,
  useSetGameGroupsMutation,
  useSetGameScriptsMutation,
  useUpdateGameMutation,
} from '@/lib/queries/use-games'
import { ipc } from '../../ipc-mock'

const GAME_ROW = {
  id: 1,
  name: 'Alan Wake 2',
  launchTarget: 'C:/Games/AlanWake2.exe',
  monitorMode: 'tree' as const,
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

  it('replaces script ids', async () => {
    ipc.override('set_game_scripts', () => [8])
    const { result } = renderHook(() => useSetGameScriptsMutation(), { wrapper: wrapper() })
    await result.current.mutateAsync({ gameId: 4, scriptIds: [8] })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(ipc.calls('set_game_scripts')).toEqual([{ gameId: 4, scriptIds: [8] }])
  })
})
