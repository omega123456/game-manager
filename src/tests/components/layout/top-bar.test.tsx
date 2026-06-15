import { screen } from '@testing-library/react'
import { waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { TopBar } from '@/components/layout/top-bar'
import { useLaunchStore } from '@/stores/launch-store'
import { useUiStore } from '@/stores/ui-store'
import { ipc } from '@/tests/ipc-mock'
import { renderWithProviders, resetUiStore } from '../../helpers/render-app'

describe('TopBar', () => {
  beforeEach(() => {
    resetUiStore()
    useLaunchStore.getState().reset()
  })

  it('renders search, Play Now, and the theme control', () => {
    renderWithProviders(<TopBar />)
    expect(screen.getByRole('searchbox', { name: 'Search games' })).toBeInTheDocument()
    expect(screen.getByTestId('play-now-button')).toBeInTheDocument()
    expect(screen.getByTestId('theme-control')).toBeInTheDocument()
  })

  it('drives the search query in the ui-store', async () => {
    const user = userEvent.setup()
    renderWithProviders(<TopBar />)
    await user.type(screen.getByRole('searchbox', { name: 'Search games' }), 'nova')
    expect(useUiStore.getState().searchQuery).toBe('nova')
  })

  it('launches the resolved Play Now game', async () => {
    const user = userEvent.setup()
    ipc.override('get_play_now_game', () => ({
      id: 2,
      name: 'Balatro',
    }))
    renderWithProviders(<TopBar />)
    await waitFor(() => expect(screen.getByTestId('play-now-button')).toBeEnabled())
    await user.click(screen.getByTestId('play-now-button'))
    expect(ipc.calls('launch_game')).toEqual([{ gameId: 2 }])
  })

  it('disables Play Now when no resume target exists', () => {
    renderWithProviders(<TopBar />)
    expect(screen.getByTestId('play-now-button')).toBeDisabled()
  })

  it('disables Play Now while a launch is already active', async () => {
    ipc.override('get_play_now_game', () => ({
      id: 2,
      name: 'Balatro',
    }))
    useLaunchStore.getState().startPreparing(8, 'Alan Wake 2')
    renderWithProviders(<TopBar />)

    await waitFor(() => expect(screen.getByTestId('play-now-button')).toBeDisabled())
  })
})
