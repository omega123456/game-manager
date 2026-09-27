import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { missingRootLabel } from '@/features/games/install-state'
import type { Game } from '@/types/domain'

export interface NotInstalledBannerProps {
  game: Pick<Game, 'launchTarget' | 'missingReason'>
  /** Shown as a "Recheck" action when the whole drive or share is missing. */
  onRecheck?: () => void
  isRechecking?: boolean
}

/** Explains why a not-installed game can't launch and how to fix it. */
export function NotInstalledBanner({
  game,
  onRecheck,
  isRechecking = false,
}: NotInstalledBannerProps): React.JSX.Element {
  const root = missingRootLabel(game.launchTarget)
  const driveMissing = game.missingReason === 'driveMissing' && root !== null
  const rootNoun = root?.startsWith('\\\\') ? 'Share' : 'Drive'

  return (
    <div
      role="note"
      className="flex flex-col gap-3 rounded-[1.4rem] border border-warning/45 bg-warning/10 p-4 sm:flex-row sm:items-start"
      data-testid="not-installed-banner"
    >
      <Icon name="link_off" className="mt-0.5 shrink-0 text-[20px] text-warning" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold text-foreground">
          {driveMissing
            ? `${rootNoun} ${root} isn't connected.`
            : "This game's launch target can't be found."}
        </p>
        <p className="text-sm text-muted-foreground">
          {driveMissing
            ? 'Reconnect it, or locate the executable to relink the game.'
            : "It may have been uninstalled or moved, or it's on a drive that isn't connected. Locate the executable to relink it."}
        </p>
      </div>
      {driveMissing && onRecheck ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={isRechecking}
          onClick={onRecheck}
        >
          <Icon name="refresh" className="text-[18px]" />
          {isRechecking ? 'Checking…' : 'Recheck'}
        </Button>
      ) : null}
    </div>
  )
}
