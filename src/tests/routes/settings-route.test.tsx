import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { SettingsRoute } from '@/routes/settings-route'
import { renderWithProviders, resetUiStore } from '../helpers/render-app'

describe('SettingsRoute', () => {
  beforeEach(() => {
    resetUiStore()
    localStorage.clear()
  })

  it('renders all settings sections in the sectioned layout', async () => {
    renderWithProviders(<SettingsRoute />)
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Updates' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Global Scripts' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'API Integrations' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
  })

  it('renders the Global Scripts placeholder when no scripts exist', () => {
    renderWithProviders(<SettingsRoute />)
    expect(screen.getByTestId('global-scripts-placeholder')).toBeInTheDocument()
  })
})
