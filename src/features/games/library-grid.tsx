import { useCallback, useEffect, useState } from 'react'
import { useVirtualizer } from '@/lib/virtual'

import type { Game, Group } from '@/types/domain'
import type { DllCatalog, GameDlssState, PresetOption } from '@/types/dlss'
import { useScrollContainerRef } from '@/components/layout/use-scroll-container'
import { GameCard } from '@/features/games/game-card'
import { useGridColumns } from '@/features/games/use-grid-columns'
import { useLaunchStore } from '@/stores/launch-store'

/** Inter-card / inter-row gap in px — mirrors Tailwind `gap-4` (1rem). */
const GAP = 16
/** Initial per-row height estimate (px) before dynamic measurement kicks in. */
const ESTIMATED_ROW_HEIGHT = 405
/** Number of off-screen rows to keep mounted on either side of the viewport. */
const OVERSCAN = 4

export interface LibraryGridProps {
  games: Game[]
  groups: Group[]
  onOpen: (gameId: number) => void
  activeLaunchGameId: number | null
  dlssStateByGameId: Map<number, GameDlssState>
  dlssCatalog?: DllCatalog
  dlssSrPresetOptions?: PresetOption[]
}

/**
 * Virtualized library grid using the react-virtual row-band pattern against the
 * app shell's existing `<main>` scroll container. The visible games are sliced
 * into rows of `columns` cards (matching the original `auto-fill, 220px` grid);
 * only the rows within the viewport plus an overscan band are mounted. The
 * virtualizer's `scrollMargin` equals the grid's offset within `<main>` so the
 * hero and toolbar continue to scroll above it.
 */
export function LibraryGrid({
  games,
  groups,
  onOpen,
  activeLaunchGameId,
  dlssStateByGameId,
  dlssCatalog,
  dlssSrPresetOptions,
}: LibraryGridProps): React.JSX.Element {
  'use no memo'
  const { columns, observe } = useGridColumns()
  const scrollRef = useScrollContainerRef()
  const rowCount = Math.ceil(games.length / columns)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [container, setContainerNode] = useState<HTMLDivElement | null>(null)
  // The LaunchBanner toggling in/out of the layout shifts `<main>`'s content,
  // so its visibility is a re-measure trigger for the grid's scroll-margin.
  const bannerVisible = useLaunchStore((s) => s.phase !== 'idle' || s.done !== null)

  // Attach the column-measuring observer and capture the node in state (rather
  // than reading a ref during render) so the offset effect can re-run.
  const setContainer = useCallback(
    (node: HTMLDivElement | null): void => {
      observe(node)
      setContainerNode(node)
    },
    [observe]
  )

  // The grid's offset *within the scroll element* (`<main>`) gives the
  // virtualizer its scroll-margin, so the hero/toolbar continue to scroll above
  // the grid. `offsetTop` is unreliable here because `<main>` is not a
  // positioned offsetParent; measure against the scroll container's own box and
  // add its current scrollTop. Re-measure when the container mounts, when the
  // launch banner toggles (it changes `<main>`'s offset), and whenever `<main>`
  // resizes.
  useEffect(() => {
    const main = scrollRef?.current
    if (!container || !main) {
      return
    }

    const measure = (): void => {
      const top = container.getBoundingClientRect().top - main.getBoundingClientRect().top
      setScrollMargin(top + main.scrollTop)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(main)
    return () => {
      observer.disconnect()
    }
  }, [container, scrollRef, bannerVisible])

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => ESTIMATED_ROW_HEIGHT + GAP,
    overscan: OVERSCAN,
    scrollMargin,
  })

  // Re-measure when the column count or scroll-margin changes (row membership or
  // banding offset shifts), so the virtual rows realign.
  useEffect(() => {
    virtualizer.measure()
  }, [columns, scrollMargin, virtualizer])

  const virtualRows = virtualizer.getVirtualItems()

  return (
    <div ref={setContainer} data-testid="library-grid">
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualRows.map((virtualRow) => {
          const start = virtualRow.index * columns
          const rowGames = games.slice(start, start + columns)
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 grid w-full gap-4"
              style={{
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                // JS is authoritative for column count: mirror the measured
                // `columns` so CSS auto-fill can't independently fit one more/
                // fewer track (sub-pixel rounding / scrollbar) and diverge from
                // the row slicing above.
                gridTemplateColumns: `repeat(${columns}, 220px)`,
              }}
            >
              {rowGames.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  groups={groups}
                  onOpen={onOpen}
                  isPlaying={activeLaunchGameId === game.id}
                  dlssState={dlssStateByGameId.get(game.id)}
                  dlssCatalog={dlssCatalog}
                  dlssSrPresetOptions={dlssSrPresetOptions}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
