import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { CurrentlyPlayingHero } from '@/features/games/currently-playing-hero'
import { useLaunchStore } from '@/stores/launch-store'
import { useUiStore } from '@/stores/ui-store'
import { ipc } from '@/tests/ipc-mock'
import { renderWithProviders, resetUiStore } from '@/tests/helpers/render-app'

describe('CurrentlyPlayingHero', () => {
  beforeEach(() => {
    resetUiStore()
    useLaunchStore.getState().reset()
    ipc.override('list_games', () => [
      {
        id: 1,
        name: 'Alan Wake 2',
        launchTarget: 'C:/Games/AlanWake2.exe',
        monitorMode: 'tree',
        groupIds: [],
        scriptIds: [],
        totalPlaytimeSeconds: 0,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ])
  })

  it('shows the idle launch-deck state with a disabled manage control', () => {
    renderWithProviders(<CurrentlyPlayingHero />)
    expect(screen.getByText('No session active')).toBeInTheDocument()
    expect(screen.getByTestId('hero-session-timer')).toHaveTextContent('00:00')
    expect(screen.getByRole('button', { name: /No active session/ })).toBeDisabled()
    expect(screen.getByTestId('currently-playing-hero')).toHaveAttribute('data-active', 'false')
  })

  it('shows the live session and opens the detail modal from Manage', async () => {
    const user = userEvent.setup()
    useLaunchStore.getState().startPreparing(1, 'Alan Wake 2')
    useLaunchStore.getState().applyLifecycle({
      gameId: 1,
      phase: 'playing',
      failedCount: 0,
      elapsedSeconds: 75,
    })

    renderWithProviders(<CurrentlyPlayingHero />)

    expect(screen.getByTestId('hero-session-timer')).toHaveTextContent('01:15')
    expect(screen.getByText('Currently Playing')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Manage session' }))
    await waitFor(() => {
      expect(useUiStore.getState().activeOverlay).toBe('detail')
      expect(useUiStore.getState().selectedGameId).toBe(1)
    })
  })
})
