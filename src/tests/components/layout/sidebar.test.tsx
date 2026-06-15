import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { Sidebar } from '@/components/layout/sidebar'
import { renderWithProviders, resetUiStore } from '../../helpers/render-app'

describe('Sidebar', () => {
  beforeEach(() => resetUiStore())

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

  it('Launch Game is a no-op placeholder', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Sidebar />)
    await user.click(screen.getByTestId('launch-game-button'))
    expect(screen.getByTestId('launch-game-button')).toBeInTheDocument()
  })
})
