import { Icon } from '@/components/ui/icon'
import { Button } from '@/components/ui/button'

export function LibraryLoadingState(): React.JSX.Element {
  return (
    <section aria-label="Loading library" className="space-y-4" data-testid="library-loading">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-[1.4rem] border border-border bg-card"
          >
            <div className="aspect-3/4 animate-pulse bg-surface-high" />
            <div className="space-y-3 p-4">
              <div className="h-5 w-2/3 animate-pulse rounded bg-surface-high" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-surface-high" />
              <div className="grid grid-cols-2 gap-2">
                <div className="h-20 animate-pulse rounded-xl bg-surface-low" />
                <div className="h-20 animate-pulse rounded-xl bg-surface-low" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export interface LibraryEmptyStateProps {
  hasSearch: boolean
  onAddGame: () => void
}

export function LibraryEmptyState({
  hasSearch,
  onAddGame,
}: LibraryEmptyStateProps): React.JSX.Element {
  return (
    <section
      className="rounded-[1.75rem] border border-dashed border-border bg-surface-low px-6 py-12 text-center"
      data-testid="library-empty"
    >
      <div className="mx-auto flex max-w-md flex-col items-center gap-4">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon name={hasSearch ? 'search_off' : 'photo_library'} className="text-[32px]" />
        </span>
        <div className="space-y-2">
          <h2 className="font-heading text-2xl font-bold text-foreground">
            {hasSearch ? 'No games match this search' : 'Your library is empty'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {hasSearch
              ? 'Try a broader search from the top bar or clear it to see your full library.'
              : 'Start by adding a game. The full wizard lands next, but the entry point is wired now.'}
          </p>
        </div>
        <Button type="button" onClick={onAddGame}>
          <Icon name="add_circle" className="text-[18px]" />
          Add Game
        </Button>
      </div>
    </section>
  )
}
