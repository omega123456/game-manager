import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createGame,
  deleteGame,
  getGame,
  getResolvedScripts,
  listGames,
  setGameGroups,
  setGameScripts,
  updateGame,
  type SaveGameInput,
} from '@/lib/ipc/games-commands'
import { GAMES_QUERY_KEY, GROUPS_QUERY_KEY } from '@/lib/queries/query-keys'
import type { Game } from '@/types/domain'

export function gameDetailQueryKey(id: number) {
  return [...GAMES_QUERY_KEY, id] as const
}

export function resolvedScriptsQueryKey(gameId: number) {
  return [...gameDetailQueryKey(gameId), 'resolved-scripts'] as const
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

/** Load the resolved execution entries for a game when an id is available. */
export function useResolvedScriptsQuery(gameId: number | null | undefined) {
  return useQuery({
    queryKey: resolvedScriptsQueryKey(gameId ?? -1),
    queryFn: () => getResolvedScripts(gameId as number),
    enabled: typeof gameId === 'number',
  })
}

function invalidateGames(queryClient: ReturnType<typeof useQueryClient>, gameId?: number) {
  void queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY })
  if (typeof gameId === 'number') {
    void queryClient.invalidateQueries({ queryKey: gameDetailQueryKey(gameId) })
    void queryClient.invalidateQueries({ queryKey: resolvedScriptsQueryKey(gameId) })
  }
}

function patchGameIds(game: Game, patch: Partial<Pick<Game, 'groupIds' | 'scriptIds'>>): Game {
  return {
    ...game,
    ...patch,
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
    onMutate: async ({ gameId, groupIds }) => {
      const previousGames = queryClient.getQueryData<Game[]>(GAMES_QUERY_KEY)
      const previousGame = queryClient.getQueryData<Game>(gameDetailQueryKey(gameId))

      queryClient.setQueryData<Game[] | undefined>(GAMES_QUERY_KEY, (current) =>
        current?.map((game) => (game.id === gameId ? patchGameIds(game, { groupIds }) : game))
      )
      queryClient.setQueryData<Game | undefined>(gameDetailQueryKey(gameId), (current) =>
        current ? patchGameIds(current, { groupIds }) : current
      )

      return { previousGames, previousGame }
    },
    onError: (_error, { gameId }, context) => {
      if (context?.previousGames) {
        queryClient.setQueryData(GAMES_QUERY_KEY, context.previousGames)
      }
      if (context?.previousGame) {
        queryClient.setQueryData(gameDetailQueryKey(gameId), context.previousGame)
      }
    },
    onSuccess: (_groupIds, { gameId }) => {
      invalidateGames(queryClient, gameId)
      void queryClient.invalidateQueries({ queryKey: GROUPS_QUERY_KEY })
    },
  })
}

/** Replace a game's directly assigned script ids and refresh caches. */
export function useSetGameScriptsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ gameId, scriptIds }: { gameId: number; scriptIds: number[] }) =>
      setGameScripts(gameId, scriptIds),
    onMutate: async ({ gameId, scriptIds }) => {
      const previousGames = queryClient.getQueryData<Game[]>(GAMES_QUERY_KEY)
      const previousGame = queryClient.getQueryData<Game>(gameDetailQueryKey(gameId))

      queryClient.setQueryData<Game[] | undefined>(GAMES_QUERY_KEY, (current) =>
        current?.map((game) => (game.id === gameId ? patchGameIds(game, { scriptIds }) : game))
      )
      queryClient.setQueryData<Game | undefined>(gameDetailQueryKey(gameId), (current) =>
        current ? patchGameIds(current, { scriptIds }) : current
      )

      return { previousGames, previousGame }
    },
    onError: (_error, { gameId }, context) => {
      if (context?.previousGames) {
        queryClient.setQueryData(GAMES_QUERY_KEY, context.previousGames)
      }
      if (context?.previousGame) {
        queryClient.setQueryData(gameDetailQueryKey(gameId), context.previousGame)
      }
    },
    onSuccess: (_scriptIds, { gameId }) => {
      invalidateGames(queryClient, gameId)
    },
  })
}
