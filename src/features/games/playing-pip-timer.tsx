import { useLaunchStore } from '@/stores/launch-store'
import { formatElapsed } from '@/features/launch/launch-format'

/**
 * Leaf component that subscribes only to the launch store's `elapsedSeconds`
 * slice and renders the formatted live elapsed time. Confining the per-second
 * selector to this ~1-node leaf means the 1 Hz launch tick re-renders only this
 * subtree — not the surrounding {@link GameCard} or the library grid.
 */
export function PlayingPipTimer(): React.JSX.Element {
  const elapsedSeconds = useLaunchStore((s) => s.elapsedSeconds)
  return <span className="font-mono tabular-nums">{formatElapsed(elapsedSeconds)}</span>
}
