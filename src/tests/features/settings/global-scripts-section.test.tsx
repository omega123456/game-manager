import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { GlobalScriptsSection } from '@/features/settings/global-scripts-section'
import { renderWithProviders } from '@/tests/helpers/render-app'
import { ipc, overrideIpcCommands } from '@/tests/ipc-mock'
import { useToastStore } from '@/stores/toast-store'
import { emptyPhase } from '@/features/scripts/script-form-types'
import type { Script } from '@/types/domain'

function script(id: number, name: string, kind: Script['kind'], enabled = true): Script {
  return {
    id,
    name,
    kind,
    enabled,
    priority: 5,
    beforeLaunch: emptyPhase(),
    afterLaunch: emptyPhase(),
    onExit: emptyPhase(),
    snippet: emptyPhase(),
    createdAt: '2026-01-01T00:00:00Z',
    requires: [],
  }
}

describe('GlobalScriptsSection', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('renders the placeholder when there are no global scripts', async () => {
    overrideIpcCommands({ list_scripts: () => [script(3, 'SaveLib', 'utility')] })
    renderWithProviders(<GlobalScriptsSection />)

    expect(await screen.findByTestId('global-scripts-placeholder')).toBeInTheDocument()
    expect(screen.queryByText('SaveLib')).not.toBeInTheDocument()
  })

  it('shows only scripts whose kind is global', async () => {
    overrideIpcCommands({
      list_scripts: () => [script(1, 'Overlay', 'normal'), script(2, 'Presence', 'global')],
    })
    renderWithProviders(<GlobalScriptsSection />)

    expect(await screen.findByTestId('global-scripts-list')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Run Presence globally' })).toBeChecked()
    expect(screen.queryByRole('switch', { name: 'Run Overlay globally' })).not.toBeInTheDocument()
  })

  it('disables a global script without changing its kind', async () => {
    overrideIpcCommands({
      list_scripts: () => [script(1, 'Overlay', 'global')],
      set_script_enabled: (args) => script(1, 'Overlay', 'global', args?.enabled as boolean),
    })
    const user = userEvent.setup()
    renderWithProviders(<GlobalScriptsSection />)

    await user.click(await screen.findByRole('switch', { name: 'Run Overlay globally' }))
    await waitFor(() => expect(ipc.calls('set_script_enabled')).toHaveLength(1))
    expect(ipc.calls('set_script_enabled')[0]).toEqual({ id: 1, enabled: false })
    expect(ipc.calls('set_script_kind')).toHaveLength(0)
  })

  it('keeps disabled global scripts listed and re-enables them', async () => {
    overrideIpcCommands({
      list_scripts: () => [script(1, 'Overlay', 'global', false)],
      set_script_enabled: (args) => script(1, 'Overlay', 'global', args?.enabled as boolean),
    })
    const user = userEvent.setup()
    renderWithProviders(<GlobalScriptsSection />)

    const toggle = await screen.findByRole('switch', { name: 'Run Overlay globally' })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    await waitFor(() => expect(ipc.calls('set_script_enabled')).toHaveLength(1))
    expect(ipc.calls('set_script_enabled')[0]).toEqual({ id: 1, enabled: true })
  })

  it('toasts when the enabled update fails', async () => {
    overrideIpcCommands({
      list_scripts: () => [script(1, 'Overlay', 'global')],
      set_script_enabled: () => {
        throw new Error('db locked')
      },
    })
    const user = userEvent.setup()
    renderWithProviders(<GlobalScriptsSection />)

    await user.click(await screen.findByRole('switch', { name: 'Run Overlay globally' }))
    await waitFor(() =>
      expect(
        useToastStore.getState().toasts.some((t) => t.title === 'Could not update global script')
      ).toBe(true)
    )
    expect(ipc.calls('log_frontend').length).toBeGreaterThan(0)
  })
})
