import { useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
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
import { GameDetailGroupsTab } from '@/features/games/game-detail-groups-tab'
import { GameDetailScriptsTab } from '@/features/games/game-detail-scripts-tab'
import { GameDetailDlssTab } from '@/features/dlss/game-detail-dlss-tab'
import { toCoverImageUrl } from '@/lib/asset-url'
import { logFrontend } from '@/lib/app-log-commands'
import { useDeleteGameMutation, useGameQuery } from '@/lib/queries/use-games'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'
import { useLaunchStore } from '@/stores/launch-store'
import { launchGameById } from '@/features/launch/launch-controller'

type GameDetailTab = 'overview' | 'edit' | 'groups' | 'scripts' | 'dlss'

const gameDetailTabTriggerClass = cn(
  'relative flex w-full justify-center rounded-md border-0 bg-transparent px-3 py-4 text-sm font-medium shadow-none transition-colors',
  'text-muted-foreground hover:bg-surface-high hover:text-foreground',
  'data-[state=active]:bg-transparent data-[state=active]:!text-primary data-[state=active]:shadow-none',
  'data-[state=active]:hover:bg-surface-high data-[state=active]:hover:!text-primary',
  "data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5 data-[state=active]:after:bg-primary data-[state=active]:after:content-['']"
)

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
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [dlssFooterHost, setDlssFooterHost] = useState<HTMLDivElement | null>(null)
  const gameQuery = useGameQuery(selectedGameId)
  const deleteGameMutation = useDeleteGameMutation()
  const isLaunchActive = useLaunchStore((state) => state.phase !== 'idle')

  const game = gameQuery.data
  const meta = game ? getLibraryMeta(game.totalPlaytimeSeconds, game.lastPlayedAt) : null

  async function handleDelete(): Promise<void> {
    if (!selectedGameId) return
    setDeleteError(null)
    try {
      await deleteGameMutation.mutateAsync(selectedGameId)
      closeDetailModal()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not delete the game right now.'
      setDeleteError(message)
      logFrontend('error', 'Failed to delete game.', {
        category: 'games.delete',
        details: message,
      })
    }
  }

  return (
    <DialogContent
      className="flex h-[min(1100px,70vh)] w-[min(1500px,70vw)] max-w-none flex-col gap-0 overflow-hidden border-white/10 bg-background/95 p-0 backdrop-blur-xl"
      onOpenAutoFocus={(event) => event.preventDefault()}
    >
      <div className="shrink-0 border-b border-border bg-surface-low/80 px-6 py-5">
        <DialogHeader className="gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Game detail
              </p>
              <DialogTitle className="text-2xl">{game?.name ?? 'Loading game…'}</DialogTitle>
              <DialogDescription>
                Tune launch details, group membership, script inheritance, and the resolved
                execution preview in one place.
              </DialogDescription>
            </div>
            <div className="flex items-center gap-1">
              {game ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsDeleteConfirmOpen(true)}
                  aria-label="Delete game"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Icon name="delete" className="text-[18px]" />
                </Button>
              ) : null}
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
          </div>
        </DialogHeader>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as GameDetailTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 border-b border-border bg-surface-container px-6">
          <TabsList
            aria-label="Game detail tabs"
            className="inline-grid h-auto w-auto grid-flow-col auto-cols-fr gap-2 rounded-none bg-transparent p-0"
          >
            <TabsTrigger value="overview" className={gameDetailTabTriggerClass}>
              Overview
            </TabsTrigger>
            <TabsTrigger value="edit" className={gameDetailTabTriggerClass}>
              Edit
            </TabsTrigger>
            <TabsTrigger value="groups" className={gameDetailTabTriggerClass}>
              Groups
            </TabsTrigger>
            <TabsTrigger value="scripts" className={gameDetailTabTriggerClass}>
              Scripts
            </TabsTrigger>
            <TabsTrigger value="dlss" className={gameDetailTabTriggerClass}>
              DLSS
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <TabsContent value="overview" className="mt-0">
              {gameQuery.isLoading || !game || !meta ? (
                <div
                  className="grid gap-6 lg:grid-cols-[19rem_1fr]"
                  data-testid="game-detail-loading"
                >
                  <div className="aspect-3/4 self-start animate-pulse rounded-[1.8rem] bg-surface-high" />
                  <div className="space-y-4">
                    <div className="h-8 w-52 animate-pulse rounded-full bg-surface-high" />
                    <div className="h-24 animate-pulse rounded-[1.5rem] bg-surface-high" />
                    <div className="grid gap-4 md:grid-cols-2">
                      {Array.from({ length: 2 }).map((_, index) => (
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
                  <div className="self-start overflow-hidden rounded-[1.8rem] border border-border bg-card shadow-sm">
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
                              Launch runs this game's resolved script pipeline. Track live status in
                              the banner and the currently-playing hero.
                            </p>
                          </div>
                          <Button
                            type="button"
                            disabled={isLaunchActive}
                            onClick={() => launchGameById(game.id, game.name)}
                            data-testid="game-detail-launch"
                          >
                            <Icon name="play_circle" className="text-[18px]" />
                            {isLaunchActive ? 'Launch in progress…' : 'Launch Game'}
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

                    <section className="grid gap-4 md:grid-cols-2">
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
                    </section>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="edit" className="mt-0">
              {game ? <GameEditForm key={game.id} game={game} /> : null}
            </TabsContent>

            <TabsContent value="groups" className="mt-0">
              {game ? <GameDetailGroupsTab game={game} /> : null}
            </TabsContent>

            <TabsContent value="scripts" className="mt-0">
              {game ? <GameDetailScriptsTab game={game} /> : null}
            </TabsContent>

            <TabsContent value="dlss" className="mt-0">
              {game ? <GameDetailDlssTab gameId={game.id} footerHost={dlssFooterHost} /> : null}
            </TabsContent>
          </div>
          {activeTab === 'dlss' && game ? (
            <div
              className="shrink-0 border-t border-border bg-background/95 px-6 py-4"
              data-testid="game-detail-dlss-footer-shell"
            >
              <div ref={setDlssFooterHost} />
            </div>
          ) : null}
        </div>
      </Tabs>

      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {game?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the game and all its play history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? <p className="text-sm text-destructive">{deleteError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteGameMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={(e) => {
                e.preventDefault()
                void handleDelete()
              }}
              disabled={deleteGameMutation.isPending}
            >
              {deleteGameMutation.isPending ? 'Deleting…' : 'Delete game'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
