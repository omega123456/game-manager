import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { TopBar } from '@/components/layout/top-bar'
import { useUiStore } from '@/stores/ui-store'
import { renderWithProviders, resetUiStore } from '../../helpers/render-app'

describe('TopBar', () => {
  beforeEach(() => {
    resetUiStore()
  })

  it('renders search and the theme control', () => {
    renderWithProviders(<TopBar />)
    expect(screen.getByRole('searchbox', { name: 'Search games' })).toBeInTheDocument()
    expect(screen.getByTestId('theme-control')).toBeInTheDocument()
    expect(screen.queryByTestId('play-now-button')).not.toBeInTheDocument()
  })

  it('drives the search query in the ui-store', async () => {
    const user = userEvent.setup()
    renderWithProviders(<TopBar />)
    await user.type(screen.getByRole('searchbox', { name: 'Search games' }), 'nova')
    expect(useUiStore.getState().searchQuery).toBe('nova')
  })
})
