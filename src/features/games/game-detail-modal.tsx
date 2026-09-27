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
import { GameEditForm } from '@/features/games/game-edit-form'
import { GameDetailGroupsTab } from '@/features/games/game-detail-groups-tab'
import { GameDetailScriptsTab } from '@/features/games/game-detail-scripts-tab'
import { DlssUnsupportedCallout } from '@/features/dlss/dlss-unsupported-callout'
import { GameDetailDlssTab } from '@/features/dlss/game-detail-dlss-tab'
import { GameDetailOverview } from '@/features/games/game-detail-overview'
import { isGameInstalled } from '@/features/games/install-state'
import { NotInstalledBadge } from '@/features/games/not-installed-badge'
import { logFrontend } from '@/lib/app-log-commands'
import { useDeleteGameMutation, useGameQuery } from '@/lib/queries/use-games'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'

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

  const game = gameQuery.data
  const installed = game ? isGameInstalled(game) : true

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
              <div className="flex flex-wrap items-center gap-3">
                <DialogTitle className="text-2xl">{game?.name ?? 'Loading game…'}</DialogTitle>
                {installed ? null : <NotInstalledBadge />}
              </div>
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
              {gameQuery.isLoading || !game ? (
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
                <GameDetailOverview game={game} />
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
              {game && installed ? (
                <GameDetailDlssTab gameId={game.id} footerHost={dlssFooterHost} />
              ) : null}
              {game && !installed ? (
                <DlssUnsupportedCallout
                  title="DLSS detection needs the game installed"
                  description="Locate the executable, then reopen this tab."
                />
              ) : null}
            </TabsContent>
          </div>
          {activeTab === 'dlss' && game && installed ? (
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
