import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Group } from '@/types/domain'
import type { InstallFilter } from '@/features/games/install-state'
import type { LibrarySortKey } from '@/features/games/library-types'

export interface LibraryToolbarProps {
  /** Number of games in the active install segment. */
  gameCount: number
  visibleCount: number
  installFilter: InstallFilter
  installedCount: number
  notInstalledCount: number
  /** Search matches hidden in the other segment (0 hides the jump link). */
  otherSegmentMatches: number
  onInstallFilterChange: (value: InstallFilter) => void
  onRecheckInstalls: () => void
  isRecheckingInstalls: boolean
  searchQuery: string
  sortKey: LibrarySortKey
  groups: Group[]
  groupFilter: 'all' | number
  onGroupFilterChange: (value: 'all' | number) => void
  onSortChange: (value: LibrarySortKey) => void
  onSearchChange: (value: string) => void
  onAddGame: () => void
}

export function LibraryToolbar({
  gameCount,
  visibleCount,
  installFilter,
  installedCount,
  notInstalledCount,
  otherSegmentMatches,
  onInstallFilterChange,
  onRecheckInstalls,
  isRecheckingInstalls,
  searchQuery,
  sortKey,
  groups,
  groupFilter,
  onGroupFilterChange,
  onSortChange,
  onSearchChange,
  onAddGame,
}: LibraryToolbarProps): React.JSX.Element {
  const noun = installFilter === 'installed' ? 'installed game' : 'not installed game'
  const countLabel =
    visibleCount === gameCount
      ? `${gameCount} ${noun}${gameCount === 1 ? '' : 's'}`
      : `${visibleCount} of ${gameCount} ${noun}s`
  const otherFilter: InstallFilter = installFilter === 'installed' ? 'notInstalled' : 'installed'

  return (
    <section className="flex flex-col gap-4 rounded-[1.5rem] border border-border bg-surface-low p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1 lg:max-w-sm lg:flex-none">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Library
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-heading text-2xl font-bold text-foreground">Your collection</h2>
            <span className="whitespace-nowrap rounded-full bg-surface-high px-3 py-1 text-sm text-muted-foreground">
              {countLabel}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {searchQuery
              ? `Filtered by "${searchQuery}".`
              : 'Browse cover art, filter by group, sort by recent activity, and jump into adding new games.'}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end lg:justify-end">
          <div className="w-full sm:w-64">
            <label
              htmlFor="library-search"
              className="mb-2 block cursor-pointer text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
            >
              Search
            </label>
            <div className="relative">
              <Icon
                name="search"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-muted-foreground"
              />
              <Input
                id="library-search"
                type="search"
                aria-label="Search games"
                placeholder="Search games…"
                className="pl-10"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
              />
            </div>
          </div>

          <div className="w-full sm:w-56">
            <label
              htmlFor="library-group-filter"
              className="mb-2 block cursor-pointer text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
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
              className="mb-2 block cursor-pointer text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
            >
              Sort by
            </label>
            <Select
              value={sortKey}
              onValueChange={(value) => onSortChange(value as LibrarySortKey)}
            >
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
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <SegmentedControl
          aria-label="Install state"
          value={installFilter}
          onValueChange={onInstallFilterChange}
          options={[
            { value: 'installed', label: 'Installed', count: installedCount },
            { value: 'notInstalled', label: 'Not installed', count: notInstalledCount },
          ]}
        />
        {otherSegmentMatches > 0 ? (
          <button
            type="button"
            className="cursor-pointer text-sm font-semibold text-primary underline underline-offset-4"
            onClick={() => onInstallFilterChange(otherFilter)}
            data-testid="library-other-segment-hint"
          >
            +{otherSegmentMatches} more in{' '}
            {otherFilter === 'installed' ? 'Installed' : 'Not installed'}
          </button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={isRecheckingInstalls}
          onClick={onRecheckInstalls}
          title="Check every game's launch target again"
        >
          <Icon name="refresh" className="text-[18px]" />
          {isRecheckingInstalls ? 'Checking installs…' : 'Recheck installs'}
        </Button>
      </div>
    </section>
  )
}
