import { launchGameById } from '@/features/launch/launch-controller'
import { usePlayNowGameQuery } from '@/lib/queries/use-games'
import { useLaunchStore } from '@/stores/launch-store'

export interface PlayNowTarget {
  gameId: number
  gameName: string
}

/**
 * Shared Play Now state for the persistent app-shell buttons.
 *
 * The backend resolves staleness/fallback; the frontend only needs the current
 * target (if any) and a single click handler.
 */
export function usePlayNowTarget(): {
  target: PlayNowTarget | null
  disabled: boolean
  launch: () => void
} {
  const query = usePlayNowGameQuery()
  const isLaunchActive = useLaunchStore((state) => state.isActive())
  const target =
    query.data === null || query.data === undefined
      ? null
      : {
          gameId: query.data.id,
          gameName: query.data.name,
        }

  return {
    target,
    disabled: query.isLoading || target === null || isLaunchActive,
    launch: () => {
      if (target) {
        launchGameById(target.gameId, target.gameName)
      }
    },
  }
}
