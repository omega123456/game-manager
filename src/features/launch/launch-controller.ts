import { cancelLaunch, launchGame } from '@/lib/ipc/launch-commands'
import { logFrontend, toastError } from '@/lib/app-log-commands'
import { useLaunchStore } from '@/stores/launch-store'

/**
 * Kick off a launch for a game. Optimistically moves the banner into its
 * "Preparing" state, then fires the backend command. Backend progress arrives via
 * the `launch://*` events the launch-store subscribes to. Fire-and-forget; a
 * failed invoke surfaces a non-blocking toast and resets the live state.
 */
export function launchGameById(gameId: number, gameName?: string): void {
  const store = useLaunchStore.getState()
  if (store.isActive()) {
    return
  }
  store.startPreparing(gameId, gameName)
  void launchGame(gameId).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    toastError('Could not launch the game.', {
      category: 'launch.start',
      details: message,
    })
    // Only roll back the optimistic "preparing" state. If backend lifecycle
    // events have already advanced the launch, keep the live state intact.
    const live = useLaunchStore.getState()
    if (live.gameId === gameId && live.phase === 'before') {
      useLaunchStore.getState().reset()
    }
  })
}

/**
 * Cancel the active launch. Marks the cancel as in-flight (disabling the control)
 * and calls the backend; the terminal `ended` event clears the live state.
 */
export function cancelActiveLaunch(): void {
  const { gameId, cancelling, setCancelling } = useLaunchStore.getState()
  if (gameId === null || cancelling) {
    return
  }
  setCancelling(true)
  void cancelLaunch(gameId).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    logFrontend('warn', 'Cancel request failed.', {
      category: 'launch.cancel',
      details: message,
    })
    useLaunchStore.getState().setCancelling(false)
  })
}
