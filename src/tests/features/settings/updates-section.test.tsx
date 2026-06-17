import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { UpdatesSection } from '@/features/settings/updates-section'
import { useUpdateStore } from '@/stores/update-store'
import { ipc } from '../../ipc-mock'
import { renderWithProviders, resetUiStore } from '../../helpers/render-app'

describe('UpdatesSection', () => {
  beforeEach(() => {
    resetUiStore()
    localStorage.clear()
    useUpdateStore.setState({
      status: 'idle',
      availableVersion: null,
      downloadProgress: 0,
      errorMessage: null,
      hasCheckedOnStartup: false,
      updateObject: null,
    })
  })

  it('renders the manual check button', () => {
    renderWithProviders(<UpdatesSection />)
    expect(screen.getByTestId('updates-check-button')).toHaveTextContent('Check for updates')
  })

  it('runs a manual update check from the button', async () => {
    const user = userEvent.setup()
    renderWithProviders(<UpdatesSection />)

    await user.click(screen.getByTestId('updates-check-button'))

    await waitFor(() => expect(ipc.calls('plugin:updater|check')).toHaveLength(1))
  })

  it('shows an available update and installs it', async () => {
    const user = userEvent.setup()
    ipc.override('plugin:updater|check', () => ({
      rid: 101,
      version: '0.2.0',
      currentVersion: '0.1.0',
      date: '2026-06-16T12:00:00.000Z',
      body: 'Release 0.2.0',
      rawJson: null,
    }))
    ipc.override('plugin:updater|download_and_install', (args) => {
      const onEvent = args?.onEvent as { onmessage?: (event: unknown) => void } | undefined
      onEvent?.onmessage?.({ event: 'Started', data: { contentLength: 100 } })
      onEvent?.onmessage?.({ event: 'Progress', data: { chunkLength: 100 } })
      onEvent?.onmessage?.({ event: 'Finished' })
      return null
    })

    renderWithProviders(<UpdatesSection />)
    await user.click(screen.getByTestId('updates-check-button'))

    expect(await screen.findByTestId('updates-install-button')).toHaveTextContent('Update now')
    expect(screen.getByTestId('updates-status')).toHaveTextContent('Version 0.2.0 is available.')

    await user.click(screen.getByTestId('updates-install-button'))

    expect(await screen.findByTestId('updates-restart-button')).toHaveTextContent(
      'Restart to update'
    )
  })

  it('shows restart errors without leaving the ready state', async () => {
    const user = userEvent.setup()
    useUpdateStore.setState({
      status: 'ready-to-restart',
      availableVersion: '0.2.0',
      downloadProgress: 100,
      errorMessage: null,
      updateObject: null,
    })
    ipc.override('plugin:process|restart', () => {
      throw new Error('restart failed')
    })

    renderWithProviders(<UpdatesSection />)
    await user.click(screen.getByTestId('updates-restart-button'))

    expect(await screen.findByTestId('updates-restart-error')).toHaveTextContent(
      'Restart failed: restart failed'
    )
  })
})
