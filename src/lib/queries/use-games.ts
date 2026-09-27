import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createGame,
  deleteGame,
  getGame,
  getLatestLaunchRun,
  getPlayNowGame,
  getResolvedScripts,
  listGames,
  recheckInstalls,
  setGameGroups,
  setGameScripts,
  updateGame,
  type SaveGameInput,
} from '@/lib/ipc/games-commands'
import {
  DLSS_APPLICABLE_QUERY_KEY,
  DLSS_STATES_QUERY_KEY,
  GAMES_QUERY_KEY,
  GROUPS_QUERY_KEY,
  PLAY_NOW_QUERY_KEY,
  SCRIPT_EXECUTION_QUERY_KEY,
} from '@/lib/queries/query-keys'
import { logFrontend } from '@/lib/app-log-commands'
import { useLaunchStore } from '@/stores/launch-store'
import { useUiStore } from '@/stores/ui-store'
import type { Game, InstallRecheckSummary } from '@/types/domain'

/**
 * Sentinel game id baked into query keys while a real id is unavailable. Paired
 * with `enabled: typeof gameId === 'number'`, the query never runs with it — it
 * only keeps the key shape stable so React Query doesn't churn cache entries.
 */
const DISABLED_GAME_ID = -1

export function gameDetailQueryKey(id: number) {
  return [...GAMES_QUERY_KEY, id] as const
}

export function resolvedScriptsQueryKey(gameId: number) {
  return [...gameDetailQueryKey(gameId), 'resolved-scripts'] as const
}

export function latestLaunchRunQueryKey(gameId: number) {
  return [...SCRIPT_EXECUTION_QUERY_KEY, 'latest-run', gameId] as const
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
    queryKey: gameDetailQueryKey(id ?? DISABLED_GAME_ID),
    queryFn: () => getGame(id as number),
    enabled: typeof id === 'number',
  })
}

/** Load the current Play Now target, or `null` when no history exists. */
export function usePlayNowGameQuery() {
  return useQuery({
    queryKey: PLAY_NOW_QUERY_KEY,
    queryFn: getPlayNowGame,
  })
}

/** Load the resolved execution entries for a game when an id is available. */
export function useResolvedScriptsQuery(gameId: number | null | undefined) {
  return useQuery({
    queryKey: resolvedScriptsQueryKey(gameId ?? DISABLED_GAME_ID),
    queryFn: () => getResolvedScripts(gameId as number),
    enabled: typeof gameId === 'number',
  })
}

/** Load the latest retained launch run for a game when an id is available. */
export function useLatestLaunchRunQuery(gameId: number | null | undefined) {
  const activeLaunchGameId = useLaunchStore((state) =>
    state.phase === 'idle' ? null : state.gameId
  )

  const query = useQuery({
    queryKey: latestLaunchRunQueryKey(gameId ?? DISABLED_GAME_ID),
    queryFn: () => getLatestLaunchRun(gameId as number),
    enabled: typeof gameId === 'number',
  })

  const isFreshLaunchForGame =
    typeof gameId === 'number' && activeLaunchGameId === gameId && query.data?.status !== 'active'

  if (isFreshLaunchForGame) {
    return {
      ...query,
      data: null,
    }
  }

  return query
}

/** Mutation key shared by every install recheck, so UI can show a pending state. */
export const RECHECK_INSTALLS_MUTATION_KEY = ['games', 'recheck-installs'] as const

/** Invalidate every cache derived from the game library (and one game's detail). */
export function invalidateGameQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  gameId?: number
): void {
  void queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: PLAY_NOW_QUERY_KEY })
  // Adding/removing/editing a game changes the set the backend scans for DLSS,
  // so refresh the (session-only) detection that drives the library pills and
  // the management-page applicable counts.
  void queryClient.invalidateQueries({ queryKey: DLSS_STATES_QUERY_KEY })
  void queryClient.invalidateQueries({ queryKey: DLSS_APPLICABLE_QUERY_KEY })
  if (typeof gameId === 'number') {
    void queryClient.invalidateQueries({ queryKey: gameDetailQueryKey(gameId) })
    void queryClient.invalidateQueries({ queryKey: resolvedScriptsQueryKey(gameId) })
    void queryClient.invalidateQueries({ queryKey: latestLaunchRunQueryKey(gameId) })
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
      invalidateGameQueries(queryClient, game.id)
    },
  })
}

/** Update a game and refresh list/detail caches. */
export function useUpdateGameMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: SaveGameInput }) => updateGame(id, input),
    onSuccess: (game: Game) => {
      // Seed the detail cache with the saved row before refetching, so a view
      // that remounts in between (e.g. the Edit tab after "Locate executable…")
      // starts from the new launch target instead of the stale one.
      queryClient.setQueryData(gameDetailQueryKey(game.id), game)
      invalidateGameQueries(queryClient, game.id)
    },
  })
}

/**
 * Re-check every game's launch target. Caches are only refreshed when some
 * game's install state actually changed.
 */
export function useRecheckInstallsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: RECHECK_INSTALLS_MUTATION_KEY,
    mutationFn: recheckInstalls,
    onSuccess: (summary: InstallRecheckSummary) => {
      for (const gameId of summary.changedGameIds) {
        invalidateGameQueries(queryClient, gameId)
      }
    },
  })
}

/**
 * Run one install recheck per app session, at startup. The session flag lives
 * in the UI store and is set before the mutation fires, so a remount (React
 * StrictMode, route changes) never triggers a second startup check.
 */
export function useStartupInstallRecheck(): void {
  const { mutate } = useRecheckInstallsMutation()
  useEffect(() => {
    const { startupInstallRecheckStarted, markStartupInstallRecheckStarted } = useUiStore.getState()
    if (startupInstallRecheckStarted) {
      return
    }
    markStartupInstallRecheckStarted()
    mutate(undefined, {
      onError: (error: unknown) => {
        logFrontend('warn', 'Startup install recheck failed.', {
          category: 'games.install',
          details: error instanceof Error ? error.message : String(error),
        })
      },
    })
  }, [mutate])
}

/** Delete a game and refresh the list cache. */
export function useDeleteGameMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteGame(id),
    onSuccess: (_value, id) => {
      invalidateGameQueries(queryClient, id)
      // The DB cascade removes the game's game_groups rows; refresh groups so
      // member lists and counts drop the deleted game.
      void queryClient.invalidateQueries({ queryKey: GROUPS_QUERY_KEY })
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
      invalidateGameQueries(queryClient, gameId)
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
      invalidateGameQueries(queryClient, gameId)
    },
  })
}
