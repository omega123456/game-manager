import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createGame,
  deleteGame,
  getGame,
  listGames,
  setGameGroups,
  setGameScripts,
  updateGame,
  type SaveGameInput,
} from '@/lib/ipc/games-commands'
import type { Game } from '@/types/domain'

export const GAMES_QUERY_KEY = ['games'] as const

export function gameDetailQueryKey(id: number) {
  return [...GAMES_QUERY_KEY, id] as const
}

/** Load the full game library. */
export function useGamesQuery() {
  return useQuery({
    queryKey: GAMES_QUERY_KEY,
    queryFn: listGames,
  })
}

/** Load a single game when an id is available. */
export function useGameQuery(id: number | null | undefined) {
  return useQuery({
    queryKey: gameDetailQueryKey(id ?? -1),
    queryFn: () => getGame(id as number),
    enabled: typeof id === 'number',
  })
}

function invalidateGames(queryClient: ReturnType<typeof useQueryClient>, gameId?: number) {
  void queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY })
  if (typeof gameId === 'number') {
    void queryClient.invalidateQueries({ queryKey: gameDetailQueryKey(gameId) })
  }
}

/** Create a game and refresh the game library cache. */
export function useCreateGameMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveGameInput) => createGame(input),
    onSuccess: (game: Game) => {
      invalidateGames(queryClient, game.id)
    },
  })
}

/** Update a game and refresh list/detail caches. */
export function useUpdateGameMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: SaveGameInput }) => updateGame(id, input),
    onSuccess: (game: Game) => {
      invalidateGames(queryClient, game.id)
    },
  })
}

/** Delete a game and refresh the list cache. */
export function useDeleteGameMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteGame(id),
    onSuccess: (_value, id) => {
      invalidateGames(queryClient, id)
    },
  })
}

/** Replace a game's group ids and refresh caches. */
export function useSetGameGroupsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ gameId, groupIds }: { gameId: number; groupIds: number[] }) =>
      setGameGroups(gameId, groupIds),
    onSuccess: (_groupIds, { gameId }) => {
      invalidateGames(queryClient, gameId)
    },
  })
}

/** Replace a game's directly assigned script ids and refresh caches. */
export function useSetGameScriptsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ gameId, scriptIds }: { gameId: number; scriptIds: number[] }) =>
      setGameScripts(gameId, scriptIds),
    onSuccess: (_scriptIds, { gameId }) => {
      invalidateGames(queryClient, gameId)
    },
  })
}
