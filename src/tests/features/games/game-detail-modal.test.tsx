import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { AppRoutes } from '@/routes/app-routes'
import { renderWithProviders, resetUiStore } from '@/tests/helpers/render-app'
import { ipc, overrideIpcCommands } from '@/tests/ipc-mock'
import type { Game } from '@/types/domain'

const BASE_GAME: Game = {
  id: 1,
  name: 'Alan Wake 2',
  launchTarget: 'C:/Games/AlanWake2.exe',
  monitorMode: 'tree',
  imagePath: 'https://images.example.test/alan-wake-2.png',
  groupIds: [1],
  scriptIds: [2],
  totalPlaytimeSeconds: 8420,
  lastPlayedAt: '2026-06-14T21:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
}

function installGameMocks(overrides?: Partial<Game>) {
  let storedGame: Game = { ...BASE_GAME, ...overrides }

  overrideIpcCommands({
    list_games: () => [storedGame],
    get_game: () => storedGame,
    list_groups: () => [
      { id: 1, name: 'HDR Games', description: 'Shared HDR setup', scriptIds: [4], gameIds: [1] },
      { id: 2, name: 'Deck Verified', description: null, scriptIds: [5], gameIds: [] },
    ],
    list_scripts: () => [
      {
        id: 2,
        name: 'Auto-Save Manager',
        kind: 'normal',
        description: null,
        priority: 7,
        beforeLaunch: { mode: 'path', path: 'C:/Commands/autosave.ps1' },
        afterLaunch: { mode: 'none' },
        onExit: { mode: 'none' },
        snippet: { mode: 'none' },
        createdAt: '2026-01-02T00:00:00Z',
        requires: [3],
      },
      {
        id: 4,
        name: 'Gamma Sweep',
        kind: 'normal',
        description: null,
        priority: 6,
        beforeLaunch: { mode: 'inline', inline: 'Run-Gamma', interpreter: 'powershell' },
        afterLaunch: { mode: 'none' },
        onExit: { mode: 'none' },
        snippet: { mode: 'none' },
        createdAt: '2026-01-04T00:00:00Z',
        requires: [],
      },
      {
        id: 3,
        name: 'SaveLib',
        kind: 'utility',
        description: null,
        priority: 5,
        beforeLaunch: { mode: 'none' },
        afterLaunch: { mode: 'none' },
        onExit: { mode: 'none' },
        snippet: { mode: 'inline', inline: 'function Save-State {}', interpreter: 'powershell' },
        createdAt: '2026-01-03T00:00:00Z',
        requires: [],
      },
    ],
    get_resolved_scripts: () => [
      {
        scriptId: 2,
        name: 'Auto-Save Manager',
        priority: 7,
        phase: 'before',
        provenance: 'direct',
        order: 1,
        requiredUtilityNames: ['SaveLib'],
      },
      {
        scriptId: 4,
        name: 'Gamma Sweep',
        priority: 6,
        phase: 'before',
        provenance: 'group',
        groupName: 'HDR Games',
        order: 2,
        requiredUtilityNames: [],
      },
    ],
    update_game: (args) => {
      const input = args?.input as Record<string, unknown>
      storedGame = {
        ...storedGame,
        id: Number(args?.id ?? storedGame.id),
        name: String(input.name),
        launchTarget: String(input.launchTarget),
        monitorMode: input.monitorMode as Game['monitorMode'],
        monitorProcessName: (input.monitorProcessName as string | null | undefined) ?? undefined,
        arguments: (input.arguments as string | null | undefined) ?? undefined,
        imagePath: (input.imagePath as string | null | undefined) ?? undefined,
        groupIds: storedGame.groupIds,
        scriptIds: storedGame.scriptIds,
      }
      return storedGame
    },
    set_game_scripts: (args) => {
      storedGame = { ...storedGame, scriptIds: ((args?.scriptIds as number[]) ?? []).slice() }
      return storedGame.scriptIds
    },
    set_game_groups: (args) => {
      storedGame = { ...storedGame, groupIds: ((args?.groupIds as number[]) ?? []).slice() }
      return storedGame.groupIds
    },
  })

  return {
    getGame: () => storedGame,
  }
}

describe('GameDetailModal', () => {
  beforeEach(() => {
    resetUiStore()
  })

  it('opens from a library card, shows resolved scripts, and closes cleanly', async () => {
    installGameMocks()
    const user = userEvent.setup()

    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Open Alan Wake 2' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('tab', { name: 'Overview' })).toBeInTheDocument()
    expect(within(dialog).getByRole('tab', { name: 'Groups' })).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'Launch available in Phase E' })
    ).toBeDisabled()

    await user.click(within(dialog).getByRole('tab', { name: 'Scripts' }))
    expect(await screen.findByTestId('game-detail-scripts-tab')).toBeInTheDocument()
    expect(screen.getByText('Resolved execution order')).toBeInTheDocument()
    expect(screen.getByText('Group: HDR Games')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Close game detail' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('updates direct scripts from the scripts tab', async () => {
    installGameMocks()
    const user = userEvent.setup()

    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Open Alan Wake 2' }))
    await user.click(await screen.findByRole('tab', { name: 'Scripts' }))

    await user.click(screen.getByRole('button', { name: 'Add script' }))
    await user.click(await screen.findByRole('option', { name: 'Gamma Sweep' }))
    await waitFor(() => {
      expect(ipc.calls('set_game_scripts')).toHaveLength(1)
    })
    expect(ipc.calls('set_game_scripts')[0]).toEqual({ gameId: 1, scriptIds: [2, 4] })
  })

  it('updates group membership from the groups tab', async () => {
    installGameMocks()
    const user = userEvent.setup()

    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Open Alan Wake 2' }))
    await user.click(await screen.findByRole('tab', { name: 'Groups' }))
    expect(await screen.findByTestId('game-detail-groups-tab')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add group' }))
    await user.click(await screen.findByRole('option', { name: 'Deck Verified' }))
    await waitFor(() => {
      expect(ipc.calls('set_game_groups')).toHaveLength(1)
    })
    expect(ipc.calls('set_game_groups')[0]).toEqual({ gameId: 1, groupIds: [1, 2] })
  })

  it('keeps inherited scripts tied to selected groups instead of resolved preview entries', async () => {
    installGameMocks()
    overrideIpcCommands({
      list_groups: () => [
        { id: 1, name: 'HDR Games', description: 'Shared HDR setup', scriptIds: [], gameIds: [1] },
        { id: 2, name: 'Deck Verified', description: null, scriptIds: [5], gameIds: [] },
      ],
      get_resolved_scripts: () => [
        {
          scriptId: 4,
          name: 'Gamma Sweep',
          priority: 6,
          phase: 'before',
          provenance: 'group',
          groupName: 'HDR Games',
          order: 1,
          requiredUtilityNames: [],
        },
      ],
    })
    const user = userEvent.setup()

    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Open Alan Wake 2' }))
    await user.click(await screen.findByRole('tab', { name: 'Scripts' }))

    expect(await screen.findByText('No inherited scripts yet.')).toBeInTheDocument()
    expect(screen.getByText('Group: HDR Games')).toBeInTheDocument()
  })

  it('preserves optimistic group membership across sequential edits', async () => {
    let releaseFirstMutation: (() => void) | null = null
    installGameMocks()
    ipc.override(
      'set_game_groups',
      (args) =>
        new Promise<number[]>((resolve) => {
          if ((args?.groupIds as number[]).includes(2)) {
            releaseFirstMutation = () => resolve((args?.groupIds as number[]) ?? [])
            return
          }
          resolve((args?.groupIds as number[]) ?? [])
        })
    )
    const user = userEvent.setup()

    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Open Alan Wake 2' }))
    await user.click(await screen.findByRole('tab', { name: 'Groups' }))
    const groupsTab = await screen.findByTestId('game-detail-groups-tab')

    await user.click(screen.getByRole('button', { name: 'Add group' }))
    await user.click(await screen.findByRole('option', { name: 'Deck Verified' }))

    expect(await within(groupsTab).findByText('Deck Verified')).toBeInTheDocument()
    expect(within(groupsTab).getByLabelText('Remove HDR Games')).toBeDisabled()

    releaseFirstMutation?.()
    await waitFor(() => {
      expect(ipc.calls('set_game_groups')).toHaveLength(1)
    })

    await user.click(await screen.findByLabelText('Remove HDR Games'))
    await waitFor(() => {
      expect(ipc.calls('set_game_groups')).toHaveLength(2)
    })
    expect(ipc.calls('set_game_groups')[1]).toEqual({ gameId: 1, groupIds: [2] })
  })

  it('drops optimistic group membership once refreshed game data disagrees', async () => {
    const state = installGameMocks()
    ipc.override('set_game_groups', (_args) => {
      state.getGame().groupIds = [1]
      return [1]
    })
    const user = userEvent.setup()

    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Open Alan Wake 2' }))
    await user.click(await screen.findByRole('tab', { name: 'Groups' }))
    const groupsTab = await screen.findByTestId('game-detail-groups-tab')

    await user.click(screen.getByRole('button', { name: 'Add group' }))
    await user.click(await screen.findByRole('option', { name: 'Deck Verified' }))

    await waitFor(() => {
      expect(ipc.calls('set_game_groups')).toHaveLength(1)
    })
    await waitFor(() => {
      expect(within(groupsTab).queryByText('Deck Verified')).not.toBeInTheDocument()
    })
    expect(within(groupsTab).getByText('HDR Games')).toBeInTheDocument()
  })

  it('edits and saves a game, deriving the monitor process name from the selected executable', async () => {
    const state = installGameMocks()
    overrideIpcCommands({
      'plugin:dialog|open': (args) => {
        const options = args?.options as { title?: string } | undefined
        switch (options?.title) {
          case 'Select launch executable':
            return 'D:/Launchers/EpicGamesLauncher.exe'
          case 'Select monitor executable':
            return 'D:/Games/AlanWake2/AlanWake2.exe'
          case 'Select cover art':
            return 'D:/Art/alan-wake-2-deluxe.png'
          default:
            return null
        }
      },
    })
    const user = userEvent.setup()

    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Open Alan Wake 2' }))
    await user.click(await screen.findByRole('tab', { name: 'Edit' }))

    await user.clear(screen.getByLabelText('Game name'))
    await user.type(screen.getByLabelText('Game name'), 'Alan Wake 2 Deluxe')
    await user.click(screen.getAllByRole('button', { name: 'Browse' })[0]!)
    await user.type(screen.getByLabelText('Launch arguments'), ' -fullscreen')
    await user.click(screen.getByRole('switch', { name: 'Enable launcher monitoring' }))
    await user.click(screen.getAllByRole('button', { name: 'Browse' })[1]!)
    await user.click(screen.getByRole('button', { name: 'Change cover' }))

    expect(
      screen.getByText((_, element) => element?.textContent === 'Saved process name: AlanWake2.exe')
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(ipc.calls('update_game')).toHaveLength(1)
    })
    expect(ipc.calls('update_game')[0]).toEqual({
      id: 1,
      input: {
        name: 'Alan Wake 2 Deluxe',
        launchTarget: 'D:/Launchers/EpicGamesLauncher.exe',
        monitorMode: 'named',
        monitorProcessName: 'AlanWake2.exe',
        arguments: '-fullscreen',
        imagePath: 'D:/Art/alan-wake-2-deluxe.png',
      },
    })
    expect(state.getGame().monitorProcessName).toBe('AlanWake2.exe')
  })

  it('preserves the typed monitor executable value when launcher mode is toggled off and on', async () => {
    installGameMocks({
      monitorMode: 'named',
      monitorProcessName: 'Balatro.exe',
    })
    const user = userEvent.setup()

    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Open Alan Wake 2' }))
    await user.click(await screen.findByRole('tab', { name: 'Edit' }))

    const monitorInput = await screen.findByLabelText('Monitor executable')
    await user.clear(monitorInput)
    await user.type(monitorInput, 'C:/SteamLibrary/common/Balatro/Balatro.exe')
    expect(
      screen.getByText((_, element) => element?.textContent === 'Saved process name: Balatro.exe')
    ).toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Enable launcher monitoring' }))
    expect(screen.queryByLabelText('Monitor executable')).not.toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Enable launcher monitoring' }))
    expect(
      await screen.findByDisplayValue('C:/SteamLibrary/common/Balatro/Balatro.exe')
    ).toBeInTheDocument()
    expect(
      screen.getByText((_, element) => element?.textContent === 'Saved process name: Balatro.exe')
    ).toBeInTheDocument()
  })

  it('validates required fields before saving', async () => {
    installGameMocks()
    const user = userEvent.setup()

    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Open Alan Wake 2' }))
    await user.click(await screen.findByRole('tab', { name: 'Edit' }))

    await user.clear(screen.getByLabelText('Game name'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Enter a game name before saving.')).toBeInTheDocument()
    expect(ipc.calls('update_game')).toHaveLength(0)

    await user.type(screen.getByLabelText('Game name'), 'Alan Wake 2')
    await user.click(screen.getByRole('switch', { name: 'Enable launcher monitoring' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(
      await screen.findByText(
        'Choose the executable the app should watch after the launcher opens.'
      )
    ).toBeInTheDocument()
    expect(ipc.calls('update_game')).toHaveLength(0)
  })

  it('requires a launch target before saving edits', async () => {
    installGameMocks()
    const user = userEvent.setup()

    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Open Alan Wake 2' }))
    await user.click(await screen.findByRole('tab', { name: 'Edit' }))

    await user.clear(screen.getByLabelText('Launch target'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByText('Choose the executable Game Manager should launch.')
    ).toBeInTheDocument()
    expect(ipc.calls('update_game')).toHaveLength(0)
  })

  it('surfaces save failures from the backend', async () => {
    installGameMocks()
    ipc.override('update_game', () => {
      throw new Error('disk full')
    })
    const user = userEvent.setup()

    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Open Alan Wake 2' }))
    await user.click(await screen.findByRole('tab', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByText('Could not save the game right now. Check the fields and try again.')
    ).toBeInTheDocument()
    expect(ipc.calls('log_frontend').length).toBeGreaterThan(0)
  })

  it('shows a delete button once the game has loaded', async () => {
    installGameMocks()
    const user = userEvent.setup()

    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Open Alan Wake 2' }))

    expect(await screen.findByRole('button', { name: 'Delete game' })).toBeInTheDocument()
  })

  it('opens a confirmation dialog when delete is clicked', async () => {
    installGameMocks()
    const user = userEvent.setup()

    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Open Alan Wake 2' }))
    await user.click(await screen.findByRole('button', { name: 'Delete game' }))

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('Delete Alan Wake 2?')).toBeInTheDocument()
    expect(
      screen.getByText(/permanently remove the game and all its play history/)
    ).toBeInTheDocument()
  })

  it('cancels deletion and keeps the modal open', async () => {
    installGameMocks()
    const user = userEvent.setup()

    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Open Alan Wake 2' }))
    await user.click(await screen.findByRole('button', { name: 'Delete game' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(ipc.calls('delete_game')).toHaveLength(0)
  })

  it('confirms deletion, calls delete_game, and closes the modal', async () => {
    installGameMocks()
    const user = userEvent.setup()

    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Open Alan Wake 2' }))
    await user.click(await screen.findByRole('button', { name: 'Delete game' }))
    await user.click(await screen.findByRole('button', { name: 'Delete game' }))

    await waitFor(() => {
      expect(ipc.calls('delete_game')).toHaveLength(1)
    })
    expect(ipc.calls('delete_game')[0]).toEqual({ id: 1 })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('surfaces delete failures from the backend', async () => {
    installGameMocks()
    ipc.override('delete_game', () => {
      throw new Error('foreign key constraint')
    })
    const user = userEvent.setup()

    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Open Alan Wake 2' }))
    await user.click(await screen.findByRole('button', { name: 'Delete game' }))
    await user.click(await screen.findByRole('button', { name: 'Delete game' }))

    expect(await screen.findByText('foreign key constraint')).toBeInTheDocument()
    expect(ipc.calls('log_frontend').length).toBeGreaterThan(0)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
