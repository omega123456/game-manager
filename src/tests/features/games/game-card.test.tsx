import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { GameCard } from '@/features/games/game-card'
import type { Game, Group } from '@/types/domain'

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

  it('shows the playing pip, ring, and live counter when active', () => {
    render(<GameCard game={BASE_GAME} groups={GROUPS} isPlaying elapsedSeconds={95} />)

    const card = screen.getByTestId('game-card-playing')
    expect(card).toHaveClass('border-primary')
    expect(card).toHaveClass('ring-2')
    const pip = screen.getByTestId('game-card-playing-pip')
    expect(pip).toHaveTextContent('Playing')
    expect(pip).toHaveTextContent('01:35')
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
