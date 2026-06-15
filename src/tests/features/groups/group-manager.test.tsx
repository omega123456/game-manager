import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { AppRoutes } from '@/routes/app-routes'
import { renderWithProviders, resetUiStore } from '@/tests/helpers/render-app'
import { emptyPhase } from '@/features/scripts/script-form-types'
import { ipc, overrideIpcCommands } from '@/tests/ipc-mock'
import { useToastStore } from '@/stores/toast-store'
import type { Game, Group, Script } from '@/types/domain'

const games: Game[] = [
  {
    id: 1,
    name: 'Alan Wake 2',
    launchTarget: 'C:/Games/AlanWake2.exe',
    monitorMode: 'tree',
    groupIds: [10],
    scriptIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    totalPlaytimeSeconds: 100,
  },
  {
    id: 2,
    name: 'Balatro',
    launchTarget: 'C:/Games/Balatro.exe',
    monitorMode: 'tree',
    groupIds: [10],
    scriptIds: [],
    createdAt: '2026-01-02T00:00:00Z',
    totalPlaytimeSeconds: 200,
  },
]

const groups: Group[] = [
  {
    id: 10,
    name: 'HDR Games',
    description: 'Shared display tweaks',
    scriptIds: [2],
    gameIds: [1, 2],
  },
]

const scripts: Script[] = [
  {
    id: 1,
    name: 'Global Presence',
    kind: 'global',
    priority: 5,
    beforeLaunch: emptyPhase(),
    afterLaunch: emptyPhase(),
    onExit: emptyPhase(),
    snippet: emptyPhase(),
    createdAt: '2026-01-01T00:00:00Z',
    requires: [],
  },
  {
    id: 2,
    name: 'Auto-Save Manager',
    kind: 'normal',
    priority: 5,
    beforeLaunch: emptyPhase(),
    afterLaunch: emptyPhase(),
    onExit: emptyPhase(),
    snippet: emptyPhase(),
    createdAt: '2026-01-01T00:00:00Z',
    requires: [],
  },
  {
    id: 3,
    name: 'SaveLib',
    kind: 'utility',
    priority: 5,
    beforeLaunch: emptyPhase(),
    afterLaunch: emptyPhase(),
    onExit: emptyPhase(),
    snippet: { mode: 'inline', inline: 'function Save {}', interpreter: 'powershell' },
    createdAt: '2026-01-01T00:00:00Z',
    requires: [],
  },
  {
    id: 4,
    name: 'Frame Guard',
    kind: 'normal',
    priority: 7,
    beforeLaunch: emptyPhase(),
    afterLaunch: emptyPhase(),
    onExit: emptyPhase(),
    snippet: emptyPhase(),
    createdAt: '2026-01-02T00:00:00Z',
    requires: [],
  },
]

function installGroupPageMocks() {
  overrideIpcCommands({
    list_groups: () => groups,
    list_scripts: () => scripts,
    list_games: () => games,
    create_group: (args) => ({
      id: 99,
      gameIds: [],
      scriptIds: [],
      ...(args?.input as object),
    }),
    update_group: (args) => ({
      id: args?.id,
      gameIds: [1, 2],
      scriptIds: [2],
      ...(args?.input as object),
    }),
    delete_group: () => undefined,
    set_group_scripts: (args) => args?.scriptIds ?? [],
  })
}

describe('Group Manager', () => {
  beforeEach(() => {
    resetUiStore()
    useToastStore.setState({ toasts: [] })
  })

  it('shows the empty prompt before a group is selected', async () => {
    installGroupPageMocks()
    renderWithProviders(<AppRoutes />, { route: '/groups' })

    expect(await screen.findByText('Groups')).toBeInTheDocument()
    expect(screen.getByTestId('group-detail-empty')).toBeInTheDocument()
  })

  it('creates a new group after validating the name', async () => {
    installGroupPageMocks()
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/groups' })

    await user.click(await screen.findByRole('button', { name: 'New' }))
    await user.click(screen.getByRole('button', { name: 'Create group' }))
    expect(await screen.findByText('Enter a group name before saving.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Name'), 'Accessibility')
    await user.type(screen.getByLabelText('Description'), 'Subtitle and UI scaling profile')
    await user.click(screen.getByRole('button', { name: 'Create group' }))

    await waitFor(() => expect(ipc.calls('create_group')).toHaveLength(1))
    expect(ipc.calls('create_group')[0]).toEqual({
      input: {
        name: 'Accessibility',
        description: 'Subtitle and UI scaling profile',
      },
    })
    expect(await screen.findByTestId('group-detail-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('group-detail-empty')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Accessibility')).toBeInTheDocument()
  })

  it('edits a group and shows member games as read-only', async () => {
    installGroupPageMocks()
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/groups' })

    await user.click(await screen.findByRole('button', { name: 'Edit HDR Games' }))
    const panel = await screen.findByTestId('group-detail-panel')
    expect(within(panel).getByDisplayValue('HDR Games')).toBeInTheDocument()
    expect(screen.getByTestId('group-members-list')).toBeInTheDocument()
    expect(screen.getByText('Alan Wake 2')).toBeInTheDocument()
    expect(screen.getAllByText('Read only')).toHaveLength(2)

    await user.clear(screen.getByLabelText('Description'))
    await user.type(screen.getByLabelText('Description'), 'Updated description')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(ipc.calls('update_group')).toHaveLength(1))
    expect(ipc.calls('update_group')[0]).toEqual({
      id: 10,
      input: { name: 'HDR Games', description: 'Updated description' },
    })
  })

  it('assigns and unassigns scripts, excluding global and utility scripts from the picker', async () => {
    installGroupPageMocks()
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/groups' })

    await user.click(await screen.findByRole('button', { name: 'Edit HDR Games' }))
    await user.click(await screen.findByRole('button', { name: 'Add script' }))

    expect(await screen.findByRole('option', { name: 'Frame Guard' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Auto-Save Manager' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Global Presence' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'SaveLib' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: 'Frame Guard' }))
    await waitFor(() => expect(ipc.calls('set_group_scripts')).toHaveLength(1))
    expect(ipc.calls('set_group_scripts')[0]).toEqual({ groupId: 10, scriptIds: [2, 4] })

    await user.click(screen.getByLabelText('Remove Auto-Save Manager'))
    await waitFor(() => expect(ipc.calls('set_group_scripts')).toHaveLength(2))
    expect(ipc.calls('set_group_scripts')[1]).toEqual({ groupId: 10, scriptIds: [4] })
  })

  it('keeps optimistic group scripts visible while a script update is in flight', async () => {
    const resolveRef: { current: ((value: number[]) => void) | null } = { current: null }
    installGroupPageMocks()
    ipc.override(
      'set_group_scripts',
      (args) =>
        new Promise<number[]>((resolve) => {
          resolveRef.current = resolve
          void args
        })
    )
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/groups' })

    await user.click(await screen.findByRole('button', { name: 'Edit HDR Games' }))
    await user.click(await screen.findByRole('button', { name: 'Add script' }))
    await user.click(await screen.findByRole('option', { name: 'Frame Guard' }))

    expect(await screen.findByText('Frame Guard')).toBeInTheDocument()
    expect(screen.getByLabelText('Remove Frame Guard')).toBeDisabled()

    resolveRef.current?.([2, 4])
    await waitFor(() => expect(ipc.calls('set_group_scripts')).toHaveLength(1))
  })

  it('drops optimistic group scripts once refreshed group data disagrees', async () => {
    let storedGroups = groups.map((group) => ({ ...group }))
    installGroupPageMocks()
    ipc.override('list_groups', () => storedGroups)
    ipc.override('set_group_scripts', () => {
      storedGroups = storedGroups.map((group) =>
        group.id === 10 ? { ...group, scriptIds: [2] } : group
      )
      return [2]
    })
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/groups' })

    await user.click(await screen.findByRole('button', { name: 'Edit HDR Games' }))
    await user.click(await screen.findByRole('button', { name: 'Add script' }))
    await user.click(await screen.findByRole('option', { name: 'Frame Guard' }))

    await waitFor(() => expect(ipc.calls('set_group_scripts')).toHaveLength(1))
    await waitFor(() => {
      expect(screen.queryByText('Frame Guard')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Auto-Save Manager')).toBeInTheDocument()
  })

  it('deletes a group through the confirmation dialog', async () => {
    installGroupPageMocks()
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/groups' })

    await user.click(await screen.findByRole('button', { name: 'Edit HDR Games' }))
    await user.click(screen.getByRole('button', { name: 'Delete group' }))
    await user.click(await screen.findByRole('button', { name: 'Delete group' }))

    await waitFor(() => expect(ipc.calls('delete_group')).toHaveLength(1))
    expect(ipc.calls('delete_group')[0]).toEqual({ id: 10 })
    await waitFor(() => expect(screen.getByTestId('group-detail-empty')).toBeInTheDocument())
  })
})
