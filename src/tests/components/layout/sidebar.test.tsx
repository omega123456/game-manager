import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { Sidebar } from '@/components/layout/sidebar'
import { useLaunchStore } from '@/stores/launch-store'
import { ipc } from '@/tests/ipc-mock'
import { renderWithProviders, resetUiStore } from '../../helpers/render-app'

function LocationProbe(): React.JSX.Element {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}</span>
}

const PLAY_NOW_GAME = {
  id: 4,
  name: 'Hades II',
  imagePath: '/covers/hades-ii.png',
}

describe('Sidebar', () => {
  beforeEach(() => {
    resetUiStore()
    useLaunchStore.getState().reset()
  })

  it('renders the brand and four nav items', () => {
    renderWithProviders(<Sidebar />)
    expect(screen.getByText('Game Manager')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Game Library/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Script Manager/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Group Manager/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Settings/ })).toBeInTheDocument()
  })

  it('marks the active route with primary styling', () => {
    renderWithProviders(<Sidebar />, { route: '/library' })
    const activeLink = screen.getByRole('link', { name: /Game Library/ })
    expect(activeLink).toHaveClass('text-primary')
    expect(activeLink).toHaveClass('border-primary')
    expect(activeLink).toHaveClass('font-bold')
  })

  it('shows the continue-playing card with the resolved game title', async () => {
    ipc.override('get_play_now_game', () => PLAY_NOW_GAME)
    renderWithProviders(<Sidebar />)
    const card = await screen.findByTestId('launch-game-button')
    expect(card).toHaveAccessibleName('Launch Game: Hades II')
    expect(screen.getByText('Hades II')).toBeInTheDocument()
    expect(screen.getByText('Continue Playing')).toBeInTheDocument()
  })

  it('navigates to the library and launches the game when the card is clicked', async () => {
    const user = userEvent.setup()
    ipc.override('get_play_now_game', () => PLAY_NOW_GAME)
    renderWithProviders(
      <>
        <Sidebar />
        <LocationProbe />
      </>,
      { route: '/settings' }
    )
    await waitFor(() => expect(screen.getByTestId('launch-game-button')).toBeEnabled())
    await user.click(screen.getByTestId('launch-game-button'))
    expect(screen.getByTestId('location')).toHaveTextContent('/library')
    expect(ipc.calls('launch_game')).toEqual([{ gameId: 4 }])
  })

  it('hides the continue-playing card when no history exists', async () => {
    renderWithProviders(<Sidebar />)
    await waitFor(() => expect(screen.queryByTestId('launch-game-button')).not.toBeInTheDocument())
  })

  it('disables the card while a launch is already active', async () => {
    ipc.override('get_play_now_game', () => PLAY_NOW_GAME)
    useLaunchStore.getState().startPreparing(9, 'Control')
    renderWithProviders(<Sidebar />)
    await waitFor(() => expect(screen.getByTestId('launch-game-button')).toBeDisabled())
  })
})
