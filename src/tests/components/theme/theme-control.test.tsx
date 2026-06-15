import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { ThemeControl } from '@/components/theme/theme-control'
import { renderWithProviders, resetUiStore } from '../../helpers/render-app'

describe('ThemeControl', () => {
  beforeEach(() => {
    resetUiStore()
    localStorage.clear()
    document.documentElement.removeAttribute('data-accent')
  })

  it('renders theme and accent radio groups', () => {
    renderWithProviders(<ThemeControl />)
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Accent color' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Light theme' })).toBeInTheDocument()
  })

  it('switches theme when a theme option is chosen', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ThemeControl />)
    await user.click(screen.getByRole('radio', { name: 'Dark theme' }))
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'))
    expect(screen.getByRole('radio', { name: 'Dark theme' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('applies an accent when a swatch is chosen', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ThemeControl />)
    await user.click(screen.getByRole('radio', { name: 'Emerald accent' }))
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-accent')).toBe('emerald')
    )
  })
})
