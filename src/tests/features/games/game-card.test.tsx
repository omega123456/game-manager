import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GameCard } from '@/features/games/game-card'
import * as libraryFormat from '@/features/games/library-format'
import { useLaunchStore } from '@/stores/launch-store'
import type { Game, Group } from '@/types/domain'
import type { DllCatalog, PresetOption } from '@/types/dlss'

const GROUPS: Group[] = [
  { id: 1, name: 'HDR Games', scriptIds: [], gameIds: [] },
  { id: 2, name: 'Deck Verified', scriptIds: [], gameIds: [] },
  { id: 3, name: 'Indie Picks', scriptIds: [], gameIds: [] },
  { id: 4, name: 'Roguelikes', scriptIds: [], gameIds: [] },
  { id: 5, name: 'Short Sessions', scriptIds: [], gameIds: [] },
]

const BASE_GAME: Game = {
  id: 1,
  name: 'Alan Wake 2',
  launchTarget: 'C:/Games/AlanWake2.exe',
  monitorMode: 'tree',
  groupIds: [1],
  scriptIds: [],
  totalPlaytimeSeconds: 7200,
  lastPlayedAt: '2026-06-10T12:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
}

describe('GameCard', () => {
  afterEach(() => {
    act(() => {
      useLaunchStore.getState().reset()
    })
  })

  it('shows group pills instead of monitor and launch metadata', () => {
    render(<GameCard game={BASE_GAME} groups={GROUPS} />)

    expect(screen.getByText('HDR Games')).toBeInTheDocument()
    expect(screen.queryByText('Monitor')).not.toBeInTheDocument()
    expect(screen.queryByText('Launch target')).not.toBeInTheDocument()
  })

  it('shows three groups and an overflow pill when membership exceeds four', () => {
    render(<GameCard game={{ ...BASE_GAME, groupIds: [1, 2, 3, 4, 5] }} groups={GROUPS} />)

    expect(screen.getByText('HDR Games')).toBeInTheDocument()
    expect(screen.getByText('Deck Verified')).toBeInTheDocument()
    expect(screen.getByText('Indie Picks')).toBeInTheDocument()
    expect(screen.queryByText('Roguelikes')).not.toBeInTheDocument()
    expect(screen.getByText('2 more…')).toBeInTheDocument()
  })

  it('keeps a fixed-height group area when a game has no groups', () => {
    render(<GameCard game={{ ...BASE_GAME, groupIds: [] }} groups={GROUPS} />)

    const groupArea = screen.getByTestId('game-card-groups')
    expect(groupArea).toHaveClass('h-[4.5rem]')
    expect(groupArea).toBeEmptyDOMElement()
  })

  it('lets a single group pill fill the available row width', () => {
    render(<GameCard game={BASE_GAME} groups={GROUPS} />)

    const groupArea = screen.getByTestId('game-card-groups')
    expect(groupArea).toHaveClass('grid-cols-1')
    expect(screen.getByTitle('HDR Games')).toHaveClass('w-full')
  })

  it('lets the last group pill span the full second row when the count is odd', () => {
    render(<GameCard game={{ ...BASE_GAME, groupIds: [1, 2, 3] }} groups={GROUPS} />)

    const indieBadge = screen.getByTitle('Indie Picks')
    expect(screen.getByTestId('game-card-groups')).toHaveClass('grid-cols-2')
    expect(indieBadge).toHaveClass('col-span-2')
  })

  it('shows the playing pip, ring, and live counter when active', () => {
    act(() => {
      useLaunchStore.setState({ gameId: 1, phase: 'playing', elapsedSeconds: 95 })
    })
    render(<GameCard game={BASE_GAME} groups={GROUPS} isPlaying />)

    const card = screen.getByTestId('game-card-playing')
    expect(card).toHaveClass('border-primary')
    expect(card).toHaveClass('ring-2')
    const pip = screen.getByTestId('game-card-playing-pip')
    expect(pip).toHaveTextContent('Playing')
    expect(pip).toHaveTextContent('01:35')
  })

  it('does not re-render an idle card when a different launch ticks (KD-2)', () => {
    // A parent that subscribes to the live launch elapsed counter so it commits
    // on every tick, wrapping a real (memoized) GameCard with stable props. A
    // Profiler counts only the GameCard subtree's commits: React.memo + stable
    // props must keep that flat even as the parent re-renders each tick. Without
    // memo on GameCard, the parent's re-render would propagate and the count
    // would climb — so this probe genuinely fails if memo() is removed.
    // `getLibraryMeta` is called once per GameCardComponent execution, so a spy
    // on it counts the real card's renders. (ESM live bindings: GameCard sees
    // the spied function.)
    const metaSpy = vi.spyOn(libraryFormat, 'getLibraryMeta')

    let parentRenders = 0
    function TickingParent(): React.JSX.Element {
      // Subscribe so the parent re-renders on every elapsedSeconds change.
      useLaunchStore((s) => s.elapsedSeconds)
      parentRenders += 1
      return <GameCard game={BASE_GAME} groups={GROUPS} />
    }

    // Start a launch for a *different* game so this idle card's props stay stable.
    act(() => {
      useLaunchStore.setState({ gameId: 99, phase: 'playing', elapsedSeconds: 0 })
    })
    render(<TickingParent />)
    const cardBefore = metaSpy.mock.calls.length
    const parentBefore = parentRenders

    act(() => {
      useLaunchStore.getState().tick()
      useLaunchStore.getState().tick()
      useLaunchStore.getState().tick()
    })

    // The parent re-rendered on each tick; the memoized GameCard did not. If
    // `memo()` were removed from GameCard, the parent's re-renders would
    // propagate and this count would climb.
    expect(parentRenders).toBeGreaterThan(parentBefore)
    expect(metaSpy.mock.calls.length).toBe(cardBefore)

    metaSpy.mockRestore()
  })

  it('does not render the playing pip when idle', () => {
    render(<GameCard game={BASE_GAME} groups={GROUPS} />)
    expect(screen.queryByTestId('game-card-playing-pip')).not.toBeInTheDocument()
    expect(screen.getByTestId('game-card')).toHaveClass('border-border')
  })

  it('renders DLSS pills from cached state', () => {
    render(
      <GameCard
        game={BASE_GAME}
        groups={GROUPS}
        dlssState={{
          gameId: 1,
          superResolution: { version: '3.7.10', path: 'a' },
          stale: false,
        }}
      />
    )
    expect(screen.getByTestId('dlss-pills')).toHaveTextContent('SR 3.7')
  })

  it('offsets DLSS pills below the playing pip', () => {
    render(
      <GameCard
        game={BASE_GAME}
        groups={GROUPS}
        isPlaying
        dlssState={{
          gameId: 1,
          superResolution: { version: '3.7.10', path: 'a' },
          stale: false,
        }}
      />
    )
    expect(screen.getByTestId('dlss-pills')).toHaveClass('top-12')
  })

  it('renders no pills when DLSS state is absent', () => {
    render(<GameCard game={BASE_GAME} groups={GROUPS} />)
    expect(screen.queryByTestId('dlss-pills')).not.toBeInTheDocument()
  })

  it('forwards the catalog and SR preset options to the pills', () => {
    const catalog: DllCatalog = {
      superResolution: [
        {
          type: 'superResolution',
          version: '3.7.10',
          versionNumber: 3710,
          label: '3.7.10',
          md5: 'm',
          zipMd5: 'z',
          downloadUrl: 'https://example.test/x.zip',
          fileSizeBytes: 1,
          zipSizeBytes: 1,
          isSignatureValid: true,
          isDownloaded: true,
        },
      ],
      frameGeneration: [],
      rayReconstruction: [],
      source: 'static',
    }
    const presetOptions: PresetOption[] = [{ value: 5, name: 'Preset E', deprecated: false }]
    render(
      <GameCard
        game={BASE_GAME}
        groups={GROUPS}
        dlssState={{
          gameId: 1,
          superResolution: { version: '3.7.10', path: 'a' },
          srPreset: 5,
          stale: false,
        }}
        dlssCatalog={catalog}
        dlssSrPresetOptions={presetOptions}
      />
    )
    const sr = screen.getByText(/SR 3\.7 \(E\)/)
    expect(sr).toHaveClass('text-success')
  })

  it('removes a broken cover image instead of showing the browser fallback', async () => {
    render(
      <GameCard
        game={{ ...BASE_GAME, imagePath: 'https://images.example.test/missing.png' }}
        groups={GROUPS}
      />
    )

    fireEvent.error(screen.getByRole('img', { name: 'Alan Wake 2 cover art' }))

    await waitFor(() => {
      expect(screen.queryByRole('img', { name: 'Alan Wake 2 cover art' })).not.toBeInTheDocument()
    })
  })

  it('truncates long group names within a grid cell and exposes the full name', () => {
    const longName = 'asad asdsa dsad ds asd sad sad sad sad sad sad sad sad sad sad sad sad sad'
    render(
      <GameCard
        game={{ ...BASE_GAME, groupIds: [1, 2, 3, 4, 5] }}
        groups={[{ id: 1, name: longName, scriptIds: [], gameIds: [] }, ...GROUPS.slice(1)]}
      />
    )

    const longBadge = screen.getByTitle(longName)
    expect(longBadge).toHaveClass('overflow-hidden')
    expect(longBadge.querySelector('span.truncate')).toHaveTextContent(longName)
    expect(screen.getByText('2 more…')).toBeInTheDocument()
  })
})
