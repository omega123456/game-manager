import type { Game, Group } from '@/types/domain'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import { GameCardGroups } from '@/features/games/game-card-groups'
import { getLibraryMeta } from '@/features/games/library-format'
import { formatElapsed } from '@/features/launch/launch-format'
import { toCoverImageUrl } from '@/lib/asset-url'

export interface GameCardProps {
  game: Game
  groups: Group[]
  onOpen?: (gameId: number) => void
  /** True when this game is the active launch session. */
  isPlaying?: boolean
  /** Live elapsed seconds for the active session (only meaningful when playing). */
  elapsedSeconds?: number
}

export function GameCard({
  game,
  groups,
  onOpen,
  isPlaying = false,
  elapsedSeconds = 0,
}: GameCardProps): React.JSX.Element {
  const meta = getLibraryMeta(game.totalPlaytimeSeconds, game.lastPlayedAt)
  const coverUrl = toCoverImageUrl(game.imagePath)

  return (
    <article
      className={cn(
        'group overflow-hidden rounded-[1.4rem] border bg-card shadow-sm transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg',
        isPlaying ? 'border-primary ring-2 ring-primary/40' : 'border-border'
      )}
      data-testid={isPlaying ? 'game-card-playing' : 'game-card'}
    >
      <button
        type="button"
        className="block w-full cursor-pointer text-left"
        onClick={() => onOpen?.(game.id)}
        aria-label={`Open ${game.name}`}
      >
        <div className="relative aspect-3/4 overflow-hidden bg-surface-high">
          {isPlaying ? (
            <span
              className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-secondary/40 bg-secondary/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary-foreground backdrop-blur"
              data-testid="game-card-playing-pip"
            >
              <span
                className="h-2 w-2 rounded-full bg-secondary motion-safe:animate-pulse"
                aria-hidden
              />
              Playing · <span className="font-mono tabular-nums">{formatElapsed(elapsedSeconds)}</span>
            </span>
          ) : null}
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={`${game.name} cover art`}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-linear-to-br from-primary/20 via-transparent to-secondary/15">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-border bg-surface-low text-primary">
                <Icon name="sports_esports" className="text-[40px]" />
              </div>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-background/90 via-background/45 to-transparent p-4">
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background/80 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
              <Icon
                name={game.lastPlayedAt ? 'history' : 'deployed_code'}
                className="text-[14px]"
              />
              {meta.lastPlayed}
            </span>
          </div>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <h2 className="font-heading text-lg font-bold text-card-foreground">{game.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{meta.playtime}</p>
          </div>
          <GameCardGroups groupIds={game.groupIds} groups={groups} />
        </div>
      </button>
    </article>
  )
}
