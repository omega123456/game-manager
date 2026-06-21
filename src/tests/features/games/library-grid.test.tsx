import { useRef, type ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ScrollContainerProvider } from '@/components/layout/scroll-container-context'
import { LibraryGrid } from '@/features/games/library-grid'
import type { Game } from '@/types/domain'
import type { GameDlssState } from '@/types/dlss'

function makeGame(id: number): Game {
  return {
    id,
    name: `Game ${id}`,
    launchTarget: `C:/Games/Game${id}.exe`,
    monitorMode: 'tree',
    groupIds: [],
    scriptIds: [],
    totalPlaytimeSeconds: 0,
    createdAt: '2026-01-01T00:00:00Z',
  }
}

/**
 * Renders LibraryGrid inside a scroll container provider whose ref points at a
 * real scrolling element, mirroring the app shell's `<main>`. The setup's jsdom
 * layout stubs give that element a measurable viewport so the virtualizer
 * windows rows.
 */
function Harness({ games }: { games: Game[] }): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const wrap = (children: ReactNode): React.JSX.Element => (
    <div ref={scrollRef} style={{ height: 600, overflow: 'auto' }}>
      <ScrollContainerProvider scrollRef={scrollRef}>{children}</ScrollContainerProvider>
    </div>
  )
  return wrap(
    <LibraryGrid
      games={games}
      groups={[]}
      onOpen={() => {}}
      activeLaunchGameId={null}
      dlssStateByGameId={new Map<number, GameDlssState>()}
    />
  )
}

describe('LibraryGrid', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('measures the grid offset within the scroll container, not against the body', async () => {
    // The real bug: `offsetTop` resolves against the body (since `<main>` is not
    // a positioned offsetParent), wrongly folding TopBar/LaunchBanner heights
    // into the scroll-margin. Simulate a grid that sits 300px below the page top
    // while its scroll container sits 100px below it and is scrolled 50px:
    // the correct margin is 300 - 100 + 50 = 250 (measured within `<main>`),
    // not 300 (the body-relative offsetTop).
    const scrollRef = { current: null as HTMLDivElement | null }
    const rect = (top: number): DOMRect =>
      ({
        width: 1200,
        height: 2400,
        top,
        left: 0,
        right: 1200,
        bottom: top + 2400,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect

    // Per-element rect override: the scroll container's box sits 100px below the
    // page top; the grid container ([data-testid="library-grid"]) sits 300px
    // below it. Everything else keeps the global stub (top: 0). With scrollTop
    // 50, the correct margin measured within `<main>` is 300 - 100 + 50 = 250.
    let gridRectReads = 0
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ): DOMRect {
      if (this === scrollRef.current) {
        return rect(100)
      }
      if (this instanceof HTMLElement && this.dataset.testid === 'library-grid') {
        gridRectReads += 1
        return rect(300)
      }
      return rect(0)
    })

    // The buggy implementation reads the body-relative `offsetTop` of the grid
    // container; the fix never does. Spy on the getter so the offsetTop path,
    // if reintroduced, is caught.
    let gridOffsetTopReads = 0
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
      this: HTMLElement
    ): number {
      if (this.dataset.testid === 'library-grid') {
        gridOffsetTopReads += 1
      }
      return 300
    })

    render(
      <div
        ref={(node) => {
          if (node) {
            // Scroll container scrolled 50px.
            Object.defineProperty(node, 'scrollTop', { configurable: true, value: 50 })
          }
          scrollRef.current = node
        }}
        style={{ height: 600, overflow: 'auto' }}
      >
        <ScrollContainerProvider scrollRef={scrollRef}>
          <LibraryGrid
            games={[makeGame(1), makeGame(2)]}
            groups={[]}
            onOpen={() => {}}
            activeLaunchGameId={null}
            dlssStateByGameId={new Map<number, GameDlssState>()}
          />
        </ScrollContainerProvider>
      </div>
    )

    const grid = await screen.findByTestId('library-grid')
    await waitFor(() => {
      expect(grid.firstElementChild).toBeTruthy()
    })
    // The fix measures the grid container's offset via getBoundingClientRect
    // (within `<main>`, incl. scrollTop) and never via the body-relative
    // offsetTop. Both conditions discriminate the fix from the bug.
    await waitFor(() => {
      expect(gridRectReads).toBeGreaterThan(0)
    })
    expect(gridOffsetTopReads).toBe(0)
  })

  it('renders the grid container with the test hook', async () => {
    render(<Harness games={[makeGame(1), makeGame(2), makeGame(3)]} />)

    const grid = await screen.findByTestId('library-grid')
    await waitFor(() => {
      expect(within(grid).getByRole('button', { name: 'Open Game 1' })).toBeInTheDocument()
    })
    expect(within(grid).getAllByRole('button', { name: /Open Game/ })).toHaveLength(3)
  })

  it('windows large datasets to viewport plus overscan rows', async () => {
    const games = Array.from({ length: 200 }, (_, index) => makeGame(index + 1))
    render(<Harness games={games} />)

    const grid = await screen.findByTestId('library-grid')
    await waitFor(() => {
      expect(within(grid).getByRole('button', { name: 'Open Game 1' })).toBeInTheDocument()
    })

    const mounted = within(grid).getAllByRole('button', { name: /Open Game/ })
    // Far fewer than the full 200 cards are mounted; off-screen rows stay out.
    expect(mounted.length).toBeGreaterThan(0)
    expect(mounted.length).toBeLessThan(games.length)
  })

  it('marks the active launch card as playing', async () => {
    const games = [makeGame(1), makeGame(2)]
    const scrollRef = { current: null as HTMLDivElement | null }
    render(
      <div
        ref={(node) => {
          scrollRef.current = node
        }}
        style={{ height: 600, overflow: 'auto' }}
      >
        <ScrollContainerProvider scrollRef={scrollRef}>
          <LibraryGrid
            games={games}
            groups={[]}
            onOpen={() => {}}
            activeLaunchGameId={2}
            dlssStateByGameId={new Map<number, GameDlssState>()}
          />
        </ScrollContainerProvider>
      </div>
    )

    await waitFor(() => {
      expect(screen.getByTestId('game-card-playing')).toBeInTheDocument()
    })
    expect(screen.getByTestId('game-card-playing-pip')).toBeInTheDocument()
  })

  it('renders without a scroll-container provider', async () => {
    render(
      <LibraryGrid
        games={[makeGame(1)]}
        groups={[]}
        onOpen={() => {}}
        activeLaunchGameId={null}
        dlssStateByGameId={new Map<number, GameDlssState>()}
      />
    )

    expect(await screen.findByTestId('library-grid')).toBeInTheDocument()
  })
})
