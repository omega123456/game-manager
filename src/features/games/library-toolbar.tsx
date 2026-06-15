import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Group } from '@/types/domain'
import type { LibrarySortKey } from '@/features/games/library-types'

export interface LibraryToolbarProps {
  gameCount: number
  visibleCount: number
  searchQuery: string
  sortKey: LibrarySortKey
  groups: Group[]
  groupFilter: 'all' | number
  onGroupFilterChange: (value: 'all' | number) => void
  onSortChange: (value: LibrarySortKey) => void
  onAddGame: () => void
}

export function LibraryToolbar({
  gameCount,
  visibleCount,
  searchQuery,
  sortKey,
  groups,
  groupFilter,
  onGroupFilterChange,
  onSortChange,
  onAddGame,
}: LibraryToolbarProps): React.JSX.Element {
  const countLabel =
    visibleCount === gameCount
      ? `${gameCount} game${gameCount === 1 ? '' : 's'}`
      : `${visibleCount} of ${gameCount} games`

  return (
    <section className="flex flex-col gap-4 rounded-[1.5rem] border border-border bg-surface-low p-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Library
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-2xl font-bold text-foreground">Your collection</h2>
          <span className="rounded-full bg-surface-high px-3 py-1 text-sm text-muted-foreground">
            {countLabel}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {searchQuery
            ? `Filtered by "${searchQuery}". Top bar search applies here.`
            : 'Browse cover art, filter by group, sort by recent activity, and jump into adding new games.'}
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="w-full sm:w-56">
          <label
            htmlFor="library-group-filter"
            className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
          >
            Group
          </label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={groupFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => onGroupFilterChange('all')}
            >
              All Games
            </Button>
            <Select
              value={groupFilter === 'all' ? 'all' : String(groupFilter)}
              onValueChange={(value) =>
                onGroupFilterChange(value === 'all' ? 'all' : Number(value))
              }
              disabled={groups.length === 0}
            >
              <SelectTrigger id="library-group-filter" aria-label="Filter library by group">
                <SelectValue placeholder="All groups" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={String(group.id)}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="w-full sm:w-56">
          <label
            htmlFor="library-sort"
            className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
          >
            Sort by
          </label>
          <Select value={sortKey} onValueChange={(value) => onSortChange(value as LibrarySortKey)}>
            <SelectTrigger id="library-sort" aria-label="Sort library">
              <SelectValue placeholder="Sort library" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Last played</SelectItem>
              <SelectItem value="playtime">Total time</SelectItem>
              <SelectItem value="name">Name</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button type="button" onClick={onAddGame} className="sm:self-end">
          <Icon name="add_circle" className="text-[18px]" />
          Add Game
        </Button>
      </div>
    </section>
  )
}
