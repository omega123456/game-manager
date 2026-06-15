import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { AppearanceSection } from '@/features/settings/appearance-section'
import { renderWithProviders, resetUiStore } from '../../helpers/render-app'

describe('AppearanceSection', () => {
  beforeEach(() => {
    resetUiStore()
    localStorage.clear()
    document.documentElement.removeAttribute('data-accent')
    document.documentElement.removeAttribute('data-theme')
  })

  it('renders theme and accent radio groups', () => {
    renderWithProviders(<AppearanceSection />)
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Accent color' })).toBeInTheDocument()
  })

  it('applies the theme app-wide and persists it when a theme is chosen', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppearanceSection />)
    await user.click(screen.getByRole('radio', { name: 'Dark theme' }))
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'))
    expect(screen.getByRole('radio', { name: 'Dark theme' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(localStorage.getItem('gm.theme')).toBe('dark')
  })

  it('applies and persists an accent when a swatch is chosen', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppearanceSection />)
    await user.click(screen.getByRole('radio', { name: 'Emerald accent' }))
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-accent')).toBe('emerald')
    )
    expect(localStorage.getItem('gm.accent')).toBe('emerald')
  })
})
