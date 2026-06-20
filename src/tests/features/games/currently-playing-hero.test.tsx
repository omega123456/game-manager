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

  it('shows a Scripts button for idle Play Now games with retained latest-run data', async () => {
    const user = userEvent.setup()
    ipc.override('get_play_now_game', () => makeGame())
    ipc.override('get_latest_launch_run', () => ({
      id: 88,
      gameId: 1,
      status: 'completed' as const,
      startedAt: '2026-06-19T10:00:00Z',
      endedAt: '2026-06-19T10:01:15Z',
      failureCount: 1,
      scriptRecords: [],
    }))

    renderWithProviders(<CurrentlyPlayingHero />)

    expect(await screen.findByTestId('hero-scripts')).toBeInTheDocument()
    expect(screen.getByTestId('hero-scripts')).toHaveClass('bg-background')
    expect(screen.getByTestId('hero-play')).toBeInTheDocument()

    await user.click(screen.getByTestId('hero-scripts'))

    expect(await screen.findByText('Execution pipeline')).toBeInTheDocument()
    expect(ipc.calls('get_latest_launch_run')).toContainEqual({ gameId: 1 })
  })

  it('hides the Scripts button for idle Play Now games without retained latest-run data', async () => {
    ipc.override('get_play_now_game', () => makeGame())
    ipc.override('get_latest_launch_run', () => null)

    renderWithProviders(<CurrentlyPlayingHero />)

    expect(await screen.findByTestId('hero-play')).toBeInTheDocument()
    await waitFor(() => expect(ipc.calls('get_latest_launch_run')).toContainEqual({ gameId: 1 }))
    expect(screen.queryByTestId('hero-scripts')).not.toBeInTheDocument()
  })

  it('falls back to a gradient when the cover image fails to load', async () => {
    ipc.override('get_play_now_game', () =>
      makeGame({ imagePath: 'https://example.com/cover.png' })
    )

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
    await user.click(await screen.findByTestId('cancel-launch-confirm-action'))

    await waitFor(() => {
      expect(ipc.calls('cancel_launch')).toContainEqual({ gameId: 1 })
    })
  })

  it('shows a Scripts button during active sessions and opens the shared popover', async () => {
    const user = userEvent.setup()
    ipc.override('list_games', () => [makeGame()])
    ipc.override('get_latest_launch_run', () => ({
      id: 89,
      gameId: 1,
      status: 'active' as const,
      startedAt: '2026-06-19T10:00:00Z',
      failureCount: 0,
      scriptRecords: [],
    }))
    useLaunchStore.getState().startPreparing(1, 'Alan Wake 2')
    useLaunchStore.getState().applyLifecycle({
      gameId: 1,
      phase: 'playing',
      failedCount: 0,
      elapsedSeconds: 75,
    })

    renderWithProviders(<CurrentlyPlayingHero />)

    expect(await screen.findByTestId('hero-scripts')).toBeInTheDocument()
    expect(screen.getByTestId('hero-scripts')).toHaveClass('bg-background')
    expect(screen.getByTestId('hero-stop')).toBeInTheDocument()

    await user.click(screen.getByTestId('hero-scripts'))

    expect(await screen.findByText('Execution pipeline')).toBeInTheDocument()
    expect(ipc.calls('get_latest_launch_run')).toContainEqual({ gameId: 1 })
  })
})
