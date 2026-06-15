import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { LaunchSection } from '@/features/settings/launch-section'
import { ipc } from '../../ipc-mock'
import { renderWithProviders, resetUiStore } from '../../helpers/render-app'

describe('LaunchSection', () => {
  beforeEach(() => {
    resetUiStore()
    localStorage.clear()
  })

  it('defaults the priority toggle to on when the setting is unset', async () => {
    renderWithProviders(<LaunchSection />)
    const toggle = screen.getByRole('switch', { name: 'Raise game priority' })
    await waitFor(() => expect(toggle).toBeChecked())
  })

  it('reflects a stored false value as off', async () => {
    ipc.override('get_all_settings', () => [{ key: 'raise_game_priority', value: 'false' }])
    renderWithProviders(<LaunchSection />)
    const toggle = screen.getByRole('switch', { name: 'Raise game priority' })
    await waitFor(() => expect(toggle).not.toBeChecked())
  })

  it('persists false when toggled off from the default on state', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LaunchSection />)
    const toggle = screen.getByRole('switch', { name: 'Raise game priority' })
    await waitFor(() => expect(toggle).toBeChecked())
    await user.click(toggle)
    await waitFor(() => {
      expect(ipc.calls('set_setting')).toContainEqual({
        key: 'raise_game_priority',
        value: 'false',
      })
    })
  })

  it('persists true when toggled on from a stored false state', async () => {
    const user = userEvent.setup()
    ipc.override('get_all_settings', () => [{ key: 'raise_game_priority', value: 'false' }])
    renderWithProviders(<LaunchSection />)
    const toggle = screen.getByRole('switch', { name: 'Raise game priority' })
    await waitFor(() => expect(toggle).not.toBeChecked())
    await user.click(toggle)
    await waitFor(() => {
      expect(ipc.calls('set_setting')).toContainEqual({
        key: 'raise_game_priority',
        value: 'true',
      })
    })
  })
})
