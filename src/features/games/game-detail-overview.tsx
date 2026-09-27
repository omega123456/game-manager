import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { formatLastSeenInstalled, isGameInstalled } from '@/features/games/install-state'
import { getLibraryMeta } from '@/features/games/library-format'
import { NotInstalledBanner } from '@/features/games/not-installed-banner'
import { useManualInstallRecheck } from '@/features/games/use-manual-install-recheck'
import { useLaunchGame } from '@/features/launch/use-launch-game'
import { toastError, toastSuccess } from '@/lib/app-log-commands'
import { toCoverImageUrl } from '@/lib/asset-url'
import { pickExecutable } from '@/lib/dialog-path'
import type { SaveGameInput } from '@/lib/ipc/games-commands'
import { useUpdateGameMutation } from '@/lib/queries/use-games'
import { cn } from '@/lib/utils'
import { useLaunchStore } from '@/stores/launch-store'
import type { Game } from '@/types/domain'

export interface GameDetailOverviewProps {
  game: Game
}

/** The full save payload for `game`, with its launch target replaced. */
function relinkInput(game: Game, launchTarget: string): SaveGameInput {
  return {
    name: game.name,
    launchTarget,
    monitorMode: game.monitorMode,
    monitorProcessName: game.monitorProcessName ?? null,
    arguments: game.arguments ?? null,
    imagePath: game.imagePath ?? null,
  }
}

/** Overview tab of the game detail modal: cover, launch profile and stats. */
export function GameDetailOverview({ game }: GameDetailOverviewProps): React.JSX.Element {
  const isLaunchActive = useLaunchStore((state) => state.phase !== 'idle')
  const launchGame = useLaunchGame()
  const updateGameMutation = useUpdateGameMutation()
  const { recheck, isRechecking } = useManualInstallRecheck()
  const [isLocating, setIsLocating] = useState(false)

  const installed = isGameInstalled(game)
  const meta = getLibraryMeta(game.totalPlaytimeSeconds, game.lastPlayedAt)
  const coverUrl = toCoverImageUrl(game.imagePath)
  const lastSeen = formatLastSeenInstalled(game.lastSeenInstalledAt)

  async function handleLocate(): Promise<void> {
    setIsLocating(true)
    try {
      const path = await pickExecutable('Locate game executable')
      if (!path) {
        return
      }
      const saved = await updateGameMutation.mutateAsync({
        id: game.id,
        input: relinkInput(game, path),
      })
      if (isGameInstalled(saved)) {
        toastSuccess(`${game.name} relinked`, { category: 'games.install' })
      }
    } catch (error) {
      toastError('Could not relink the game.', {
        description: game.name,
        category: 'games.install',
        details: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsLocating(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[19rem_1fr]" data-testid="game-detail-overview">
      <div className="self-start overflow-hidden rounded-[1.8rem] border border-border bg-card shadow-sm">
        <div className="aspect-3/4 overflow-hidden bg-surface-high">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={`${game.name} cover art`}
              className={cn('h-full w-full object-cover', !installed && 'opacity-60 grayscale')}
            />
          ) : (
            <div
              className={cn(
                'flex h-full items-center justify-center bg-linear-to-br from-primary/20 via-transparent to-secondary/15 text-primary',
                !installed && 'opacity-60 grayscale'
              )}
            >
              <Icon name="photo" className="text-[52px]" />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {installed ? null : (
          <NotInstalledBanner game={game} onRecheck={recheck} isRechecking={isRechecking} />
        )}

        <section className="overflow-hidden rounded-[1.8rem] border border-border bg-surface-container">
          <div className="border-b border-border bg-linear-to-r from-primary/20 via-secondary/10 to-transparent px-6 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Launch profile
                </p>
                <h2 className="font-heading text-3xl font-bold tracking-tight text-foreground">
                  {game.name}
                </h2>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  {installed
                    ? "Launch runs this game's resolved script pipeline. Track live status in the banner and the currently-playing hero."
                    : "Launch runs this game's resolved script pipeline once it's installed again."}
                </p>
              </div>
              {installed ? (
                <Button
                  type="button"
                  disabled={isLaunchActive}
                  onClick={() => launchGame(game.id, game.name)}
                  data-testid="game-detail-launch"
                >
                  <Icon name="play_circle" className="text-[18px]" />
                  {isLaunchActive ? 'Launch in progress…' : 'Launch Game'}
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={isLocating}
                  onClick={() => void handleLocate()}
                  data-testid="game-detail-locate"
                >
                  <Icon name="folder_open" className="text-[18px]" />
                  {isLocating ? 'Relinking…' : 'Locate executable…'}
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div className="rounded-[1.4rem] border border-border bg-background/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Launch target
              </p>
              <p
                className={cn(
                  'mt-2 break-all text-sm',
                  installed
                    ? 'text-foreground'
                    : 'text-muted-foreground line-through decoration-warning'
                )}
                data-testid="game-detail-launch-target"
              >
                {game.launchTarget}
              </p>
              {!installed && lastSeen ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Last seen installed: {lastSeen}
                </p>
              ) : null}
              {game.arguments ? (
                <>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Arguments
                  </p>
                  <p className="mt-2 break-all text-sm text-foreground">{game.arguments}</p>
                </>
              ) : null}
            </div>
            <div
              className={cn(
                'rounded-[1.4rem] border p-4',
                game.monitorMode === 'named'
                  ? 'border-primary/40 bg-primary/10'
                  : 'border-border bg-background/70'
              )}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-background/80 text-primary">
                  <Icon
                    name={game.monitorMode === 'named' ? 'rocket_launch' : 'device_hub'}
                    className="text-[20px]"
                  />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {game.monitorMode === 'named'
                      ? 'Launcher-aware monitoring'
                      : 'Direct executable monitoring'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {game.monitorMode === 'named'
                      ? `Watching ${game.monitorProcessName ?? 'the selected executable'} after the launcher starts.`
                      : 'Tracking the launched process tree with zero extra setup.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <StatCard label="Total playtime" value={meta.playtime} icon="timer" tone="primary" />
          <StatCard label="Last played" value={meta.lastPlayed} icon="history" tone="secondary" />
        </section>
      </div>
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string
  icon: string
  tone: 'primary' | 'secondary' | 'default'
}

function StatCard({ label, value, icon, tone }: StatCardProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'rounded-[1.5rem] border p-4 shadow-sm',
        tone === 'primary' && 'border-primary/25 bg-primary/10',
        tone === 'secondary' && 'border-secondary/25 bg-secondary/10',
        tone === 'default' && 'border-border bg-card'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-3 font-heading text-2xl font-bold text-foreground">{value}</p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-background/80 text-primary">
          <Icon name={icon} className="text-[20px]" />
        </span>
      </div>
    </div>
  )
}
