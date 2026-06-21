import { useCallback, useMemo, useState } from 'react'

import { useGamesQuery } from '@/lib/queries/use-games'
import { useGroupsQuery } from '@/lib/queries/use-groups'
import {
  useDlssCatalogQuery,
  useDlssGameStatesQuery,
  useDlssPresetOptionsQuery,
} from '@/lib/queries/use-dlss'
import { useUiStore } from '@/stores/ui-store'
import { useLaunchStore } from '@/stores/launch-store'
import { AddGameWizard } from '@/features/games/add-game-wizard'
import { CurrentlyPlayingHero } from '@/features/games/currently-playing-hero'
import { GameDetailModal } from '@/features/games/game-detail-modal'
import { LibraryGrid } from '@/features/games/library-grid'
import { LibraryToolbar } from '@/features/games/library-toolbar'
import { LibraryEmptyState, LibraryLoadingState } from '@/features/games/library-states'
import type { LibrarySortKey } from '@/features/games/library-types'
import type { Game, Group } from '@/types/domain'
import type { GameDlssState } from '@/types/dlss'

/**
 * Stable empty-array fallback for the groups query. A fresh `?? []` allocation
 * on every render would give each `GameCard` a new `groups` reference, defeating
 * its `React.memo` and forcing idle cards to re-render on the 1 Hz launch tick.
 */
const EMPTY_GROUPS: Group[] = []

function compareByRecent(a: Game, b: Game): number {
  const left = a.lastPlayedAt ? new Date(a.lastPlayedAt).getTime() : 0
  const right = b.lastPlayedAt ? new Date(b.lastPlayedAt).getTime() : 0
  if (right !== left) {
    return right - left
  }
  return a.name.localeCompare(b.name)
}

function compareByPlaytime(a: Game, b: Game): number {
  if (b.totalPlaytimeSeconds !== a.totalPlaytimeSeconds) {
    return b.totalPlaytimeSeconds - a.totalPlaytimeSeconds
  }
  return compareByRecent(a, b)
}

function compareByName(a: Game, b: Game): number {
  return a.name.localeCompare(b.name)
}

export function LibraryRouteContent(): React.JSX.Element {
  const searchQuery = useUiStore((s) => s.searchQuery)
  const setSearchQuery = useUiStore((s) => s.setSearchQuery)
  const setActiveOverlay = useUiStore((s) => s.setActiveOverlay)
  const setSelectedGameId = useUiStore((s) => s.setSelectedGameId)
  const [sortKey, setSortKey] = useState<LibrarySortKey>('recent')
  const [groupFilter, setGroupFilter] = useState<'all' | number>('all')

  const gamesQuery = useGamesQuery()
  const groupsQuery = useGroupsQuery()
  const dlssStatesQuery = useDlssGameStatesQuery()
  const dlssCatalogQuery = useDlssCatalogQuery()
  const dlssSrPresetOptionsQuery = useDlssPresetOptionsQuery('dlss')
  const activeLaunchGameId = useLaunchStore((s) => (s.phase === 'idle' ? null : s.gameId))
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase()

  const visibleGames = useMemo(() => {
    const games = gamesQuery.data ?? []
    const groupFiltered =
      groupFilter === 'all' ? games : games.filter((game) => game.groupIds.includes(groupFilter))

    const filtered = normalizedSearch
      ? groupFiltered.filter((game) => {
          const haystack = [
            game.name,
            game.launchTarget,
            game.monitorProcessName ?? '',
            game.arguments ?? '',
          ]
            .join(' ')
            .toLocaleLowerCase()
          return haystack.includes(normalizedSearch)
        })
      : groupFiltered.slice()

    switch (sortKey) {
      case 'name':
        return filtered.sort(compareByName)
      case 'playtime':
        return filtered.sort(compareByPlaytime)
      case 'recent':
      default:
        return filtered.sort(compareByRecent)
    }
  }, [gamesQuery.data, groupFilter, normalizedSearch, sortKey])

  const totalGameCount = gamesQuery.data?.length ?? 0

  const dlssStateByGameId = useMemo(() => {
    const map = new Map<number, GameDlssState>()
    for (const state of dlssStatesQuery.data ?? []) {
      map.set(state.gameId, state)
    }
    return map
  }, [dlssStatesQuery.data])

  const openAddGame = useCallback(() => setActiveOverlay('wizard'), [setActiveOverlay])
  const openGame = useCallback(
    (gameId: number) => {
      setSelectedGameId(gameId)
      setActiveOverlay('detail')
    },
    [setSelectedGameId, setActiveOverlay]
  )

  return (
    <>
      <div className="flex min-h-full w-full flex-col gap-6 p-6 lg:p-8">
        <CurrentlyPlayingHero />
        <LibraryToolbar
          gameCount={totalGameCount}
          visibleCount={visibleGames.length}
          searchQuery={searchQuery}
          sortKey={sortKey}
          groups={groupsQuery.data ?? EMPTY_GROUPS}
          groupFilter={groupFilter}
          onGroupFilterChange={setGroupFilter}
          onSortChange={setSortKey}
          onSearchChange={setSearchQuery}
          onAddGame={openAddGame}
        />

        <section className="space-y-4" aria-busy={gamesQuery.isLoading}>
          {gamesQuery.isLoading ? <LibraryLoadingState /> : null}
          {!gamesQuery.isLoading && visibleGames.length === 0 ? (
            <LibraryEmptyState hasSearch={normalizedSearch.length > 0} onAddGame={openAddGame} />
          ) : null}
          {!gamesQuery.isLoading && visibleGames.length > 0 ? (
            <LibraryGrid
              games={visibleGames}
              groups={groupsQuery.data ?? EMPTY_GROUPS}
              onOpen={openGame}
              activeLaunchGameId={activeLaunchGameId}
              dlssStateByGameId={dlssStateByGameId}
              dlssCatalog={dlssCatalogQuery.data}
              dlssSrPresetOptions={dlssSrPresetOptionsQuery.data}
            />
          ) : null}
        </section>
      </div>
      <AddGameWizard />
      <GameDetailModal />
    </>
  )
}
