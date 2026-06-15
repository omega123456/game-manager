import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { ApiKeysSection } from '@/features/settings/api-keys-section'
import { ipc } from '../../ipc-mock'
import { renderWithProviders, resetUiStore } from '../../helpers/render-app'

describe('ApiKeysSection', () => {
  beforeEach(() => {
    resetUiStore()
    localStorage.clear()
  })

  it('renders masked inputs and info-tone hints when keys are missing', async () => {
    renderWithProviders(<ApiKeysSection />)
    const steamGrid = screen.getByLabelText('SteamGridDB API Key')
    expect(steamGrid).toHaveAttribute('type', 'password')
    expect(
      await screen.findByText('Required for cover art search and suggestions.')
    ).toBeInTheDocument()
    expect(screen.getByText('Required for Steam metadata fallback.')).toBeInTheDocument()
  })

  it('toggles visibility of a key field', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ApiKeysSection />)
    const steamGrid = screen.getByLabelText('SteamGridDB API Key')
    expect(steamGrid).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Show SteamGridDB API Key' }))
    expect(steamGrid).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide SteamGridDB API Key' }))
    expect(steamGrid).toHaveAttribute('type', 'password')
  })

  it('seeds inputs from loaded settings and hides the info hint when a key exists', async () => {
    ipc.override('get_all_settings', () => [{ key: 'steamgriddb_api_key', value: 'existing-key' }])
    renderWithProviders(<ApiKeysSection />)
    const steamGrid = screen.getByLabelText('SteamGridDB API Key')
    await waitFor(() => expect(steamGrid).toHaveValue('existing-key'))
    expect(
      screen.queryByText('Required for cover art search and suggestions.')
    ).not.toBeInTheDocument()
  })

  it('persists entered keys via set_setting and confirms the save', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ApiKeysSection />)
    await user.type(screen.getByLabelText('SteamGridDB API Key'), 'sgdb-123')
    await user.type(screen.getByLabelText('Steam Web API Key'), 'steam-456')
    await user.click(screen.getByRole('button', { name: 'Save Keys' }))

    await waitFor(() => {
      expect(ipc.calls('set_setting')).toContainEqual({
        key: 'steamgriddb_api_key',
        value: 'sgdb-123',
      })
    })
    expect(ipc.calls('set_setting')).toContainEqual({ key: 'steam_api_key', value: 'steam-456' })
    expect(await screen.findByText('Keys saved.')).toBeInTheDocument()
  })

  it('logs and does not crash when saving fails', async () => {
    const user = userEvent.setup()
    ipc.override('set_setting', () => {
      throw new Error('save failed')
    })
    renderWithProviders(<ApiKeysSection />)
    await user.type(screen.getByLabelText('SteamGridDB API Key'), 'x')
    await user.click(screen.getByRole('button', { name: 'Save Keys' }))
    await waitFor(() => expect(ipc.calls('log_frontend').length).toBeGreaterThan(0))
    expect(screen.queryByText('Keys saved.')).not.toBeInTheDocument()
  })

  it('exposes help links for both providers', () => {
    renderWithProviders(<ApiKeysSection />)
    const section = screen.getByLabelText('API Integrations')
    const links = within(section).getAllByRole('link', { name: /Get key/ })
    expect(links).toHaveLength(2)
  })
})
