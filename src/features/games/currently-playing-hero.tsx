import { Icon } from '@/components/ui/icon'
import { Button } from '@/components/ui/button'
import { useGamesQuery } from '@/lib/queries/use-games'
import { useUiStore } from '@/stores/ui-store'
import { useLaunchStore } from '@/stores/launch-store'
import { formatElapsed, phaseLabel } from '@/features/launch/launch-format'

/**
 * The "currently playing" hero. When a launch is active it surfaces the live
 * phase, the elapsed session timer, and a Manage shortcut into the game detail;
 * otherwise it shows the idle launch-deck state.
 */
export function CurrentlyPlayingHero(): React.JSX.Element {
  const phase = useLaunchStore((s) => s.phase)
  const gameId = useLaunchStore((s) => s.gameId)
  const gameName = useLaunchStore((s) => s.gameName)
  const elapsedSeconds = useLaunchStore((s) => s.elapsedSeconds)

  const gamesQuery = useGamesQuery()
  const setActiveOverlay = useUiStore((s) => s.setActiveOverlay)
  const setSelectedGameId = useUiStore((s) => s.setSelectedGameId)

  const isActive = phase !== 'idle'
  const activeGame = gamesQuery.data?.find((g) => g.id === gameId)
  const displayName = gameName ?? activeGame?.name ?? 'Your game'

  const openManage = () => {
    if (gameId === null) return
    setSelectedGameId(gameId)
    setActiveOverlay('detail')
  }

  return (
    <section
      className="relative overflow-hidden rounded-[1.75rem] border border-border bg-surface-container p-6"
      data-testid="currently-playing-hero"
      data-active={isActive}
    >
      <div className="absolute inset-x-0 top-0 h-24 bg-linear-to-r from-primary/20 via-secondary/10 to-transparent" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl space-y-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-primary">
            <Icon name="play_circle" className="text-[16px]" />
            {isActive ? 'Currently Playing' : 'Launch deck'}
          </span>
          <div className="space-y-2">
            <h1 className="font-heading text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              {isActive ? displayName : 'Your launch deck lives here.'}
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
              {isActive
                ? `${phaseLabel(phase)} — live session status and the elapsed timer update here as your scripts run.`
                : 'Press Launch on any game to run its resolved script pipeline. Live launch status and the elapsed timer appear here.'}
            </p>
          </div>
        </div>

        <div className="grid gap-3 rounded-2xl border border-border bg-surface-low p-4 sm:min-w-80 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Active game
            </p>
            <p className="mt-2 font-heading text-xl font-bold text-foreground">
              {isActive ? displayName : 'No session active'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Session timer
            </p>
            <p
              className="mt-2 font-mono text-xl font-semibold tabular-nums text-foreground"
              data-testid="hero-session-timer"
            >
              {isActive ? formatElapsed(elapsedSeconds) : '00:00'}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={!isActive}
            onClick={openManage}
            className="sm:col-span-2 sm:w-fit"
          >
            <Icon name={isActive ? 'tune' : 'radio_button_unchecked'} className="text-[18px]" />
            {isActive ? 'Manage session' : 'No active session'}
          </Button>
        </div>
      </div>
    </section>
  )
}
