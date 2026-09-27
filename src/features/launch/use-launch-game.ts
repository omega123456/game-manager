import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { launchGameById } from '@/features/launch/launch-controller'
import { invalidateGameQueries } from '@/lib/queries/use-games'

/**
 * Launch a game from a component. A failed launch refreshes the game caches,
 * because the backend's pre-launch check may have just marked the game as not
 * installed.
 */
export function useLaunchGame(): (gameId: number, gameName?: string) => void {
  const queryClient = useQueryClient()
  return useCallback(
    (gameId: number, gameName?: string) => {
      launchGameById(gameId, gameName, () => invalidateGameQueries(queryClient, gameId))
    },
    [queryClient]
  )
}
