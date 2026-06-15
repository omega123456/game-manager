import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { monacoEditorMock } from '@/tests/helpers/monaco-mock'

vi.mock('monaco-editor', () => ({}))
vi.mock('@monaco-editor/react', () => monacoEditorMock())

import { AppRoutes } from '@/routes/app-routes'
import { renderWithProviders, resetUiStore } from '@/tests/helpers/render-app'
import { ipc, overrideIpcCommands } from '@/tests/ipc-mock'
import { useToastStore } from '@/stores/toast-store'
import { emptyPhase } from '@/features/scripts/script-form-types'
import type { Script } from '@/types/domain'

const HDR: Script = {
  id: 1,
  name: 'HDR Toggle',
  description: 'Enable HDR',
  kind: 'global',
  priority: 8,
  beforeLaunch: { mode: 'inline', inline: 'Enable-HDR', interpreter: 'powershell' },
  afterLaunch: emptyPhase(),
  onExit: { mode: 'path', path: 'C:/restore.ps1' },
  snippet: emptyPhase(),
  createdAt: '2026-01-01T00:00:00Z',
  requires: [3],
}

const AUTOSAVE: Script = {
  id: 2,
  name: 'Auto-Save Manager',
  kind: 'normal',
  priority: 7,
  beforeLaunch: { mode: 'path', path: 'C:/autosave.ps1' },
  afterLaunch: emptyPhase(),
  onExit: emptyPhase(),
  snippet: emptyPhase(),
  createdAt: '2026-01-02T00:00:00Z',
  requires: [],
}

const SAVELIB: Script = {
  id: 3,
  name: 'SaveLib',
  kind: 'utility',
  priority: 5,
  beforeLaunch: emptyPhase(),
  afterLaunch: emptyPhase(),
  onExit: emptyPhase(),
  snippet: { mode: 'inline', inline: 'function Save {}', interpreter: 'powershell' },
  createdAt: '2026-01-03T00:00:00Z',
  requires: [],
}

const ALL = [HDR, AUTOSAVE, SAVELIB]

function installScriptMocks(rows: Script[] = ALL) {
  overrideIpcCommands({
    list_scripts: () => rows,
    get_script: (args) => rows.find((s) => s.id === args?.id) ?? null,
    create_script: (args) => ({
      id: 99,
      createdAt: '2026-02-01T00:00:00Z',
      requires: [],
      ...(args?.input as object),
    }),
    update_script: (args) => ({
      id: args?.id,
      createdAt: '2026-01-01T00:00:00Z',
      requires: [],
      ...(args?.input as object),
    }),
    set_script_dependencies: (args) => args?.dependsOn ?? [],
    delete_script: () => undefined,
  })
}

describe('Script Manager', () => {
  beforeEach(() => {
    resetUiStore()
    useToastStore.setState({ toasts: [] })
  })

  it('shows the list with kind chips, priority, and an empty editor prompt', async () => {
    installScriptMocks()
    renderWithProviders(<AppRoutes />, { route: '/scripts' })

    expect(await screen.findByText('Registered Scripts')).toBeInTheDocument()
    expect(screen.getByTestId('script-editor-empty')).toBeInTheDocument()
    // Utility row shows a dash for priority and no phase icons.
    const utilityRow = await screen.findByRole('button', { name: 'Edit SaveLib' })
    expect(within(utilityRow).getByLabelText('Priority')).toHaveTextContent('–')
  })

  it('edits a normal script showing the phase layout, slider, and requires picker', async () => {
    installScriptMocks()
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/scripts' })

    await user.click(await screen.findByRole('button', { name: 'Edit Auto-Save Manager' }))
    expect(await screen.findByTestId('script-phases-layout')).toBeInTheDocument()
    expect(screen.queryByTestId('script-utility-layout')).not.toBeInTheDocument()
    const panel = within(screen.getByTestId('script-editor-panel'))
    expect(panel.getByLabelText('Priority')).toBeInTheDocument()
    expect(screen.getByTestId('dependency-picker')).toBeInTheDocument()
    // beforeLaunch path is pre-seeded.
    expect(screen.getByLabelText('Before Launch script path')).toHaveValue('C:/autosave.ps1')
  })

  it('edits a utility script showing only the snippet layout', async () => {
    installScriptMocks()
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/scripts' })

    await user.click(await screen.findByRole('button', { name: 'Edit SaveLib' }))
    expect(await screen.findByTestId('script-utility-layout')).toBeInTheDocument()
    expect(screen.queryByTestId('script-phases-layout')).not.toBeInTheDocument()
    const panel = within(screen.getByTestId('script-editor-panel'))
    expect(panel.queryByLabelText('Priority')).not.toBeInTheDocument()
    // Snippet inline content is shown in the (mocked) Monaco editor.
    expect(screen.getByTestId('monaco-mock')).toHaveValue('function Save {}')
  })

  it('creates a new utility script and persists the snippet', async () => {
    installScriptMocks()
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/scripts' })

    await user.click(await screen.findByRole('button', { name: 'New' }))
    await user.type(screen.getByLabelText('Name'), 'CloudSync')
    await user.click(screen.getByRole('radio', { name: 'Utility kind' }))

    await user.click(await screen.findByRole('radio', { name: 'Code' }))
    await user.type(screen.getByTestId('monaco-mock'), 'Invoke-Sync')
    await user.click(screen.getByRole('button', { name: 'Create script' }))

    await waitFor(() => expect(ipc.calls('create_script')).toHaveLength(1))
    const payload = ipc.calls('create_script')[0] as { input: Record<string, unknown> }
    expect(payload.input.kind).toBe('utility')
    expect((payload.input.snippet as { inline: string }).inline).toBe('Invoke-Sync')
  })

  it('creates a normal script and applies require edges after creation', async () => {
    installScriptMocks()
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/scripts' })

    await user.click(await screen.findByRole('button', { name: 'New' }))
    await user.type(screen.getByLabelText('Name'), 'FPS Unlocker')
    await user.click(screen.getByRole('button', { name: 'Add Requirement' }))
    await user.click(await screen.findByRole('option', { name: /SaveLib/ }))
    await user.click(screen.getByRole('button', { name: 'Create script' }))

    await waitFor(() => expect(ipc.calls('create_script')).toHaveLength(1))
    await waitFor(() => expect(ipc.calls('set_script_dependencies')).toHaveLength(1))
    expect(ipc.calls('set_script_dependencies')[0]).toEqual({ scriptId: 99, dependsOn: [3] })
  })

  it('toasts when the backend rejects a cycle-creating requirement', async () => {
    installScriptMocks()
    ipc.override('set_script_dependencies', () => {
      throw new Error('cycle detected')
    })
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/scripts' })

    // Edit the existing normal script (so add applies immediately).
    await user.click(await screen.findByRole('button', { name: 'Edit Auto-Save Manager' }))
    await user.click(await screen.findByRole('button', { name: 'Add Requirement' }))
    await user.click(await screen.findByRole('option', { name: /SaveLib/ }))

    await waitFor(() =>
      expect(
        useToastStore.getState().toasts.some((t) => t.title === 'Could not update requirements')
      ).toBe(true)
    )
    expect(ipc.calls('log_frontend').length).toBeGreaterThan(0)
  })

  it('deletes a script through the confirmation dialog', async () => {
    installScriptMocks()
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/scripts' })

    await user.click(await screen.findByRole('button', { name: 'Edit SaveLib' }))
    await user.click(await screen.findByRole('button', { name: 'Delete script' }))
    await user.click(await screen.findByRole('button', { name: 'Delete script' }))

    await waitFor(() => expect(ipc.calls('delete_script')).toHaveLength(1))
    expect(ipc.calls('delete_script')[0]).toEqual({ id: 3 })
    await waitFor(() => expect(screen.getByTestId('script-editor-empty')).toBeInTheDocument())
  })

  it('validates the name before saving', async () => {
    installScriptMocks()
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/scripts' })

    await user.click(await screen.findByRole('button', { name: 'New' }))
    await user.click(screen.getByRole('button', { name: 'Create script' }))
    expect(await screen.findByText('Enter a script name before saving.')).toBeInTheDocument()
    expect(ipc.calls('create_script')).toHaveLength(0)
  })
})
