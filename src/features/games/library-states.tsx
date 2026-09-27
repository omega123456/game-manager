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
              <div className="grid h-[4.5rem] grid-cols-2 gap-x-2 gap-y-2">
                <div className="h-6 animate-pulse rounded-full bg-surface-low" />
                <div className="h-6 animate-pulse rounded-full bg-surface-low" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/** Which empty library situation to explain. */
export type LibraryEmptyVariant = 'empty' | 'search' | 'nothingMissing' | 'noneInstalled'

export interface LibraryEmptyStateProps {
  variant: LibraryEmptyVariant
  onAddGame: () => void
  /** Switches the library to the Not installed segment (`noneInstalled` only). */
  onShowNotInstalled?: () => void
}

const EMPTY_COPY: Record<LibraryEmptyVariant, { icon: string; title: string; body: string }> = {
  empty: {
    icon: 'photo_library',
    title: 'Your library is empty',
    body: 'Start by adding a game. The full wizard lands next, but the entry point is wired now.',
  },
  search: {
    icon: 'search_off',
    title: 'No games match this search',
    body: 'Try a broader search from the top bar or clear it to see your full library.',
  },
  nothingMissing: {
    icon: 'check_circle',
    title: 'Nothing missing',
    body: "Every game in your library is installed. Games land here automatically if their launch target can't be found.",
  },
  noneInstalled: {
    icon: 'link_off',
    title: 'Nothing installed right now',
    body: "None of your games' launch targets can be found. If they're on a drive that isn't connected, reconnect it and recheck installs.",
  },
}

export function LibraryEmptyState({
  variant,
  onAddGame,
  onShowNotInstalled,
}: LibraryEmptyStateProps): React.JSX.Element {
  const copy = EMPTY_COPY[variant]
  return (
    <section
      className="rounded-[1.75rem] border border-dashed border-border bg-surface-low px-6 py-12 text-center"
      data-testid="library-empty"
      data-variant={variant}
    >
      <div className="mx-auto flex max-w-md flex-col items-center gap-4">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon name={copy.icon} className="text-[32px]" />
        </span>
        <div className="space-y-2">
          <h2 className="font-heading text-2xl font-bold text-foreground">{copy.title}</h2>
          <p className="text-sm text-muted-foreground">{copy.body}</p>
        </div>
        {variant === 'empty' || variant === 'search' ? (
          <Button type="button" onClick={onAddGame}>
            <Icon name="add_circle" className="text-[18px]" />
            Add Game
          </Button>
        ) : null}
        {variant === 'noneInstalled' && onShowNotInstalled ? (
          <Button type="button" variant="outline" onClick={onShowNotInstalled}>
            <Icon name="link_off" className="text-[18px]" />
            Show not installed games
          </Button>
        ) : null}
      </div>
    </section>
  )
}
