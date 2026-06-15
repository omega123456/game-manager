import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getLibraryMeta } from '@/features/games/library-format'
import { GameEditForm } from '@/features/games/game-edit-form'
import { toCoverImageUrl } from '@/lib/asset-url'
import { useGameQuery } from '@/lib/queries/use-games'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'

type GameDetailTab = 'overview' | 'edit' | 'scripts'

function closeDetailModal(): void {
  useUiStore.getState().setActiveOverlay('none')
  useUiStore.getState().setSelectedGameId(null)
}

export function GameDetailModal(): React.JSX.Element {
  const isOpen = useUiStore((state) => state.activeOverlay === 'detail')
  const selectedGameId = useUiStore((state) => state.selectedGameId)

  return (
    <Dialog open={isOpen} onOpenChange={(nextOpen) => (!nextOpen ? closeDetailModal() : undefined)}>
      {isOpen ? (
        <GameDetailModalInner
          key={`${selectedGameId ?? 'none'}-open`}
          selectedGameId={selectedGameId}
        />
      ) : null}
    </Dialog>
  )
}

interface GameDetailModalInnerProps {
  selectedGameId: number | null
}

function GameDetailModalInner({ selectedGameId }: GameDetailModalInnerProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<GameDetailTab>('overview')
  const gameQuery = useGameQuery(selectedGameId)

  const game = gameQuery.data
  const meta = game ? getLibraryMeta(game.totalPlaytimeSeconds, game.lastPlayedAt) : null

  return (
    <DialogContent
      className="max-h-[90vh] max-w-5xl gap-0 overflow-hidden border-white/10 bg-background/95 p-0 backdrop-blur-xl"
      onOpenAutoFocus={(event) => event.preventDefault()}
    >
      <div className="border-b border-border bg-surface-low/80 px-6 py-5">
        <DialogHeader className="gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Game detail
              </p>
              <DialogTitle className="text-2xl">{game?.name ?? 'Loading game…'}</DialogTitle>
              <DialogDescription>
                Tune launch details now. Script assignment and launch orchestration land in later
                phases.
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={closeDetailModal}
              aria-label="Close game detail"
            >
              <Icon name="close" className="text-[18px]" />
            </Button>
          </div>
        </DialogHeader>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as GameDetailTab)}>
        <div className="border-b border-border bg-surface-low/60 px-6 py-4">
          <TabsList aria-label="Game detail tabs">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="edit">Edit</TabsTrigger>
            <TabsTrigger value="scripts">Scripts</TabsTrigger>
          </TabsList>
        </div>

        <div className="max-h-[calc(90vh-10rem)] overflow-y-auto px-6 py-6">
          <TabsContent value="overview" className="mt-0">
            {gameQuery.isLoading || !game || !meta ? (
              <div
                className="grid gap-6 lg:grid-cols-[19rem_1fr]"
                data-testid="game-detail-loading"
              >
                <div className="aspect-3/4 animate-pulse rounded-[1.8rem] bg-surface-high" />
                <div className="space-y-4">
                  <div className="h-8 w-52 animate-pulse rounded-full bg-surface-high" />
                  <div className="h-24 animate-pulse rounded-[1.5rem] bg-surface-high" />
                  <div className="grid gap-4 md:grid-cols-3">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div
                        key={index}
                        className="h-28 animate-pulse rounded-[1.4rem] bg-surface-high"
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="grid gap-6 lg:grid-cols-[19rem_1fr]"
                data-testid="game-detail-overview"
              >
                <div className="overflow-hidden rounded-[1.8rem] border border-border bg-card shadow-sm">
                  <div className="aspect-3/4 overflow-hidden bg-surface-high">
                    {toCoverImageUrl(game.imagePath) ? (
                      <img
                        src={toCoverImageUrl(game.imagePath) ?? undefined}
                        alt={`${game.name} cover art`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-linear-to-br from-primary/20 via-transparent to-secondary/15 text-primary">
                        <Icon name="photo" className="text-[52px]" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-6">
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
                            Launch wiring is staged next. This overview gives you the art, stats,
                            and configuration summary first.
                          </p>
                        </div>
                        <Button type="button" disabled>
                          <Icon name="play_circle" className="text-[18px]" />
                          Launch available in Phase E
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-4 px-6 py-5">
                      <div className="rounded-[1.4rem] border border-border bg-background/70 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Launch target
                        </p>
                        <p className="mt-2 break-all text-sm text-foreground">
                          {game.launchTarget}
                        </p>
                        {game.arguments ? (
                          <>
                            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              Arguments
                            </p>
                            <p className="mt-2 break-all text-sm text-foreground">
                              {game.arguments}
                            </p>
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

                  <section className="grid gap-4 md:grid-cols-3">
                    <StatCard
                      label="Total playtime"
                      value={meta.playtime}
                      icon="timer"
                      tone="primary"
                    />
                    <StatCard
                      label="Last played"
                      value={meta.lastPlayed}
                      icon="history"
                      tone="secondary"
                    />
                    <StatCard
                      label="Monitor mode"
                      value={game.monitorMode === 'named' ? 'Launcher' : 'Tree'}
                      icon={game.monitorMode === 'named' ? 'rocket_launch' : 'device_hub'}
                      tone="default"
                    />
                  </section>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="edit" className="mt-0">
            {game ? (
              <GameEditForm
                key={[
                  game.id,
                  game.name,
                  game.launchTarget,
                  game.monitorMode,
                  game.monitorProcessName ?? '',
                  game.arguments ?? '',
                  game.imagePath ?? '',
                ].join(':')}
                game={game}
                onSaved={() => setActiveTab('overview')}
              />
            ) : null}
          </TabsContent>

          <TabsContent value="scripts" className="mt-0">
            <section
              className="rounded-[1.8rem] border border-dashed border-border bg-surface-low/70 p-8"
              data-testid="game-detail-scripts-placeholder"
            >
              <div className="flex max-w-2xl items-start gap-4">
                <span className="mt-1 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon name="deployed_code" className="text-[24px]" />
                </span>
                <div className="space-y-2">
                  <h2 className="font-heading text-xl font-semibold text-foreground">
                    Scripts land after assignments exist
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Script assignment available after Scripts/Groups are set up. This tab will show
                    direct assignments, inherited scripts, and resolved order in Phase D3.
                  </p>
                </div>
              </div>
            </section>
          </TabsContent>
        </div>
      </Tabs>
    </DialogContent>
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
