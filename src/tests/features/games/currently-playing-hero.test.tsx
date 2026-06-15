import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { CurrentlyPlayingHero } from '@/features/games/currently-playing-hero'
import type { Game } from '@/types/domain'
import { useLaunchStore } from '@/stores/launch-store'
import { ipc } from '@/tests/ipc-mock'
import { renderWithProviders, resetUiStore } from '@/tests/helpers/render-app'

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 1,
    name: 'Alan Wake 2',
    launchTarget: 'C:/Games/AlanWake2.exe',
    monitorMode: 'tree',
    groupIds: [],
    scriptIds: [],
    totalPlaytimeSeconds: 9000,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('CurrentlyPlayingHero', () => {
  beforeEach(() => {
    resetUiStore()
    useLaunchStore.getState().reset()
  })

  it('hides the hero when there is no game to continue', async () => {
    // Default fixtures return null for get_play_now_game.
    const { container } = renderWithProviders(<CurrentlyPlayingHero />)
    await waitFor(() => expect(ipc.calls('get_play_now_game').length).toBeGreaterThan(0))
    expect(screen.queryByTestId('currently-playing-hero')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('offers the most recent game as a Continue Playing target', async () => {
    ipc.override('get_play_now_game', () => makeGame())

    renderWithProviders(<CurrentlyPlayingHero />)

    expect(await screen.findByText('Continue Playing')).toBeInTheDocument()
    expect(screen.getByText('Alan Wake 2')).toBeInTheDocument()
    expect(screen.getByTestId('hero-session-timer')).toHaveTextContent('2h 30m on record')
    expect(screen.getByTestId('currently-playing-hero')).toHaveAttribute('data-active', 'false')

    const user = userEvent.setup()
    await user.click(screen.getByTestId('hero-play'))

    await waitFor(() => {
      expect(ipc.calls('launch_game')).toContainEqual({ gameId: 1 })
    })
  })

  it('falls back to a gradient when the cover image fails to load', async () => {
    ipc.override('get_play_now_game', () => makeGame({ imagePath: 'https://example.com/cover.png' }))

    renderWithProviders(<CurrentlyPlayingHero />)

    const cover = await screen.findByRole('img', { name: /Alan Wake 2 cover art/ })
    fireEvent.error(cover)

    await waitFor(() => {
      expect(screen.queryByRole('img', { name: /Alan Wake 2 cover art/ })).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('hero-cover-fallback')).toBeInTheDocument()
  })

  it('shows the live session with a Stop control that cancels the launch', async () => {
    ipc.override('list_games', () => [makeGame()])
    useLaunchStore.getState().startPreparing(1, 'Alan Wake 2')
    useLaunchStore.getState().applyLifecycle({
      gameId: 1,
      phase: 'playing',
      failedCount: 0,
      elapsedSeconds: 75,
    })

    renderWithProviders(<CurrentlyPlayingHero />)

    expect(await screen.findByText('Currently Playing')).toBeInTheDocument()
    expect(screen.getByTestId('hero-session-timer')).toHaveTextContent('01:15')
    expect(screen.getByTestId('currently-playing-hero')).toHaveAttribute('data-active', 'true')

    const user = userEvent.setup()
    await user.click(screen.getByTestId('hero-stop'))

    await waitFor(() => {
      expect(ipc.calls('cancel_launch')).toContainEqual({ gameId: 1 })
    })
  })
})
