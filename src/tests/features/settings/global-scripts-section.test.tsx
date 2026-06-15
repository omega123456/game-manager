import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { GlobalScriptsSection } from '@/features/settings/global-scripts-section'
import { renderWithProviders } from '@/tests/helpers/render-app'
import { ipc, overrideIpcCommands } from '@/tests/ipc-mock'
import { useToastStore } from '@/stores/toast-store'
import { emptyPhase } from '@/features/scripts/script-form-types'
import type { Script } from '@/types/domain'

function script(id: number, name: string, kind: Script['kind']): Script {
  return {
    id,
    name,
    kind,
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

  it('renders the placeholder when there are no non-utility scripts', async () => {
    overrideIpcCommands({ list_scripts: () => [script(3, 'SaveLib', 'utility')] })
    renderWithProviders(<GlobalScriptsSection />)

    expect(await screen.findByTestId('global-scripts-placeholder')).toBeInTheDocument()
    // Utilities are excluded from the toggle list entirely.
    expect(screen.queryByText('SaveLib')).not.toBeInTheDocument()
  })

  it('lists non-utility scripts with a switch reflecting global state', async () => {
    overrideIpcCommands({
      list_scripts: () => [script(1, 'Overlay', 'normal'), script(2, 'Presence', 'global')],
    })
    renderWithProviders(<GlobalScriptsSection />)

    expect(await screen.findByTestId('global-scripts-list')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Run Overlay globally' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Run Presence globally' })).toBeChecked()
  })

  it('toggles a script to global via set_script_kind', async () => {
    overrideIpcCommands({
      list_scripts: () => [script(1, 'Overlay', 'normal')],
      set_script_kind: (args) => ({ ...script(1, 'Overlay', 'normal'), kind: args?.kind }),
    })
    const user = userEvent.setup()
    renderWithProviders(<GlobalScriptsSection />)

    await user.click(await screen.findByRole('switch', { name: 'Run Overlay globally' }))
    await waitFor(() => expect(ipc.calls('set_script_kind')).toHaveLength(1))
    expect(ipc.calls('set_script_kind')[0]).toEqual({ id: 1, kind: 'global' })
  })

  it('toasts when the kind update fails', async () => {
    overrideIpcCommands({
      list_scripts: () => [script(1, 'Overlay', 'normal')],
      set_script_kind: () => {
        throw new Error('db locked')
      },
    })
    const user = userEvent.setup()
    renderWithProviders(<GlobalScriptsSection />)

    await user.click(await screen.findByRole('switch', { name: 'Run Overlay globally' }))
    await waitFor(() =>
      expect(
        useToastStore.getState().toasts.some((t) => t.title === 'Could not update global flag')
      ).toBe(true)
    )
    expect(ipc.calls('log_frontend').length).toBeGreaterThan(0)
  })
})
