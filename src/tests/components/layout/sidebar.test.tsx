import { screen } from '@testing-library/react'
import { waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { Sidebar } from '@/components/layout/sidebar'
import { useLaunchStore } from '@/stores/launch-store'
import { ipc } from '@/tests/ipc-mock'
import { renderWithProviders, resetUiStore } from '../../helpers/render-app'

describe('Sidebar', () => {
  beforeEach(() => {
    resetUiStore()
    useLaunchStore.getState().reset()
  })

  it('renders the brand, four nav items, and the Launch Game button', () => {
    renderWithProviders(<Sidebar />)
    expect(screen.getByText('Game Manager')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Game Library/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Script Manager/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Group Manager/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Settings/ })).toBeInTheDocument()
    expect(screen.getByTestId('launch-game-button')).toBeInTheDocument()
  })

  it('marks the active route with primary styling', () => {
    renderWithProviders(<Sidebar />, { route: '/library' })
    expect(screen.getByRole('link', { name: /Game Library/ })).toHaveClass('text-primary')
  })

  it('launches the resolved Play Now game from the sidebar', async () => {
    const user = userEvent.setup()
    ipc.override('get_play_now_game', () => ({
      id: 4,
      name: 'Hades II',
    }))
    renderWithProviders(<Sidebar />)
    await waitFor(() => expect(screen.getByTestId('launch-game-button')).toBeEnabled())
    await user.click(screen.getByTestId('launch-game-button'))
    expect(ipc.calls('launch_game')).toEqual([{ gameId: 4 }])
  })

  it('disables Launch Game when no history exists', () => {
    renderWithProviders(<Sidebar />)
    expect(screen.getByTestId('launch-game-button')).toBeDisabled()
  })

  it('disables Launch Game while a launch is already active', async () => {
    ipc.override('get_play_now_game', () => ({
      id: 4,
      name: 'Hades II',
    }))
    useLaunchStore.getState().startPreparing(9, 'Control')
    renderWithProviders(<Sidebar />)

    await waitFor(() => expect(screen.getByTestId('launch-game-button')).toBeDisabled())
  })
})
