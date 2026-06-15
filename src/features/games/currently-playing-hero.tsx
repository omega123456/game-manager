import { useState } from 'react'

import type { Game } from '@/types/domain'
import { Icon } from '@/components/ui/icon'
import { Button } from '@/components/ui/button'
import { useGamesQuery, usePlayNowGameQuery } from '@/lib/queries/use-games'
import { useLaunchStore } from '@/stores/launch-store'
import { toCoverImageUrl } from '@/lib/asset-url'
import { cancelActiveLaunch, launchGameById } from '@/features/launch/launch-controller'
import { formatElapsed, formatLoggedPlaytime } from '@/features/launch/launch-format'

/**
 * The image-backed "currently playing" hero. While a launch is active it surfaces
 * the live session timer with a Stop control; otherwise it offers the most
 * recently played game as a "Continue Playing" target with a Play control. When
 * there is nothing to continue (first start, or the last game was removed) the
 * hero renders nothing.
 */
export function CurrentlyPlayingHero(): React.JSX.Element | null {
  const phase = useLaunchStore((s) => s.phase)
  const activeGameId = useLaunchStore((s) => s.gameId)
  const activeGameName = useLaunchStore((s) => s.gameName)
  const elapsedSeconds = useLaunchStore((s) => s.elapsedSeconds)
  const cancelling = useLaunchStore((s) => s.cancelling)

  const gamesQuery = useGamesQuery()
  const playNowQuery = usePlayNowGameQuery()

  const isActive = phase !== 'idle'
  const activeGame = gamesQuery.data?.find((g) => g.id === activeGameId)
  const game: Game | null = isActive
    ? (activeGame ?? null)
    : (playNowQuery.data ?? null)

  // Nothing to show: no active session and no game to continue.
  if (!isActive && game === null) {
    return null
  }

  const displayName = isActive
    ? (activeGameName ?? activeGame?.name ?? 'Your game')
    : (game?.name ?? 'Your game')

  return (
    <HeroCard
      game={game}
      displayName={displayName}
      isActive={isActive}
      elapsedSeconds={elapsedSeconds}
      cancelling={cancelling}
      launchDisabled={gamesQuery.isLoading || playNowQuery.isLoading}
    />
  )
}

interface HeroCardProps {
  game: Game | null
  displayName: string
  isActive: boolean
  elapsedSeconds: number
  cancelling: boolean
  launchDisabled: boolean
}

function HeroCard({
  game,
  displayName,
  isActive,
  elapsedSeconds,
  cancelling,
  launchDisabled,
}: HeroCardProps): React.JSX.Element {
  const coverUrl = toCoverImageUrl(game?.imagePath)
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null)
  const coverFailed = coverUrl !== null && failedCoverUrl === coverUrl
  const showCover = coverUrl !== null && !coverFailed

  const handlePlay = () => {
    if (game) {
      launchGameById(game.id, game.name)
    }
  }

  return (
    <section
      className="relative flex min-h-[20rem] flex-col justify-end overflow-hidden rounded-[1.75rem] border border-border bg-surface-container"
      data-testid="currently-playing-hero"
      data-active={isActive}
    >
      {showCover ? (
        <img
          src={coverUrl}
          alt={`${displayName} cover art`}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => {
            if (coverUrl) {
              setFailedCoverUrl(coverUrl)
            }
          }}
        />
      ) : (
        <div
          className="absolute inset-0 bg-linear-to-br from-primary/20 via-transparent to-secondary/15"
          data-testid="hero-cover-fallback"
        />
      )}
      <div className="absolute inset-0 bg-linear-to-t from-background/95 via-background/55 to-transparent" />

      <div className="relative z-10 flex flex-col gap-6 p-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl space-y-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary backdrop-blur">
            <Icon name="play_circle" className="text-[16px]" />
            {isActive ? 'Currently Playing' : 'Continue Playing'}
          </span>
          <h1 className="font-heading text-3xl font-extrabold tracking-tight text-foreground drop-shadow-sm sm:text-4xl">
            {displayName}
          </h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground sm:text-base">
            <Icon name="schedule" className="text-[18px]" />
            {isActive ? (
              <span
                className="font-mono font-semibold tabular-nums text-foreground"
                data-testid="hero-session-timer"
              >
                {formatElapsed(elapsedSeconds)}
              </span>
            ) : (
              <span data-testid="hero-session-timer">
                {formatLoggedPlaytime(game?.totalPlaytimeSeconds ?? 0)} on record
              </span>
            )}
          </p>
        </div>

        {isActive ? (
          <Button
            type="button"
            variant="destructive"
            size="lg"
            onClick={cancelActiveLaunch}
            disabled={cancelling}
            data-testid="hero-stop"
          >
            <Icon name="stop_circle" className="text-[20px]" />
            {cancelling ? 'Stopping…' : 'Stop'}
          </Button>
        ) : (
          <Button
            type="button"
            size="lg"
            onClick={handlePlay}
            disabled={launchDisabled || game === null}
            data-testid="hero-play"
          >
            <Icon name="play_arrow" className="text-[20px]" />
            Play
          </Button>
        )}
      </div>
    </section>
  )
}
