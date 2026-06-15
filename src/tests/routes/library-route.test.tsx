import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { AppRoutes } from '@/routes/app-routes'
import { useUiStore } from '@/stores/ui-store'
import { ipc } from '@/tests/ipc-mock'
import { renderWithProviders, resetUiStore } from '@/tests/helpers/render-app'
import type { Game } from '@/types/domain'

const GAMES: Game[] = [
  {
    id: 1,
    name: 'Alan Wake 2',
    launchTarget: 'C:/Games/AlanWake2.exe',
    monitorMode: 'tree',
    imagePath: 'https://example.com/alan-wake-2.png',
    groupIds: [1],
    scriptIds: [],
    totalPlaytimeSeconds: 7200,
    lastPlayedAt: '2026-06-10T12:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 2,
    name: 'Balatro',
    launchTarget: 'C:/Games/Balatro.exe',
    monitorMode: 'named',
    monitorProcessName: 'Balatro.exe',
    groupIds: [2],
    scriptIds: [],
    totalPlaytimeSeconds: 18000,
    lastPlayedAt: '2026-06-14T12:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 3,
    name: 'Cocoon',
    launchTarget: 'C:/Games/Cocoon.exe',
    monitorMode: 'tree',
    groupIds: [],
    scriptIds: [],
    totalPlaytimeSeconds: 0,
    createdAt: '2026-01-01T00:00:00Z',
  },
]

describe('LibraryRoute', () => {
  beforeEach(() => {
    resetUiStore()
    ipc.override('list_games', () => GAMES)
    ipc.override('list_groups', () => [
      { id: 1, name: 'HDR Games', description: null, scriptIds: [], gameIds: [1] },
      { id: 2, name: 'Deck Verified', description: null, scriptIds: [], gameIds: [2] },
    ])
    ipc.override('get_game', (args) => GAMES.find((game) => game.id === args?.id) ?? null)
  })

  it('renders mocked games with hero, toolbar, and card metadata', async () => {
    renderWithProviders(<AppRoutes />, { route: '/library' })

    expect(
      await screen.findByRole('heading', { name: 'Your launch deck lives here.' })
    ).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Your collection' })).toBeInTheDocument()

    const cards = await screen.findAllByRole('button', { name: /Open / })
    expect(cards).toHaveLength(3)
    expect(screen.getByText('Alan Wake 2')).toBeInTheDocument()
    expect(screen.getByText('2.0 hrs')).toBeInTheDocument()
    expect(screen.getByText('14 Jun 2026')).toBeInTheDocument()
    expect(screen.getByText('Never launched')).toBeInTheDocument()
  })

  it('filters from the TopBar search and sorts by the selected option', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.type(screen.getByRole('searchbox', { name: 'Search games' }), 'bal')

    await waitFor(() => {
      const grid = screen.getByTestId('library-grid')
      const buttons = within(grid).getAllByRole('button', { name: /Open / })
      expect(buttons).toHaveLength(1)
      expect(within(grid).getByRole('button', { name: 'Open Balatro' })).toBeInTheDocument()
    })

    await user.clear(screen.getByRole('searchbox', { name: 'Search games' }))
    await user.click(screen.getByRole('combobox', { name: 'Sort library' }))
    await user.click(screen.getByRole('option', { name: 'Name' }))

    const sortedButtons = within(screen.getByTestId('library-grid')).getAllByRole('button', {
      name: /Open /,
    })
    expect(sortedButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Open Alan Wake 2',
      'Open Balatro',
      'Open Cocoon',
    ])
  })

  it('filters by group and resets back to all games', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('combobox', { name: 'Filter library by group' }))
    await user.click(screen.getByRole('option', { name: 'HDR Games' }))

    await waitFor(() => {
      const buttons = within(screen.getByTestId('library-grid')).getAllByRole('button', {
        name: /Open /,
      })
      expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
        'Open Alan Wake 2',
      ])
    })

    await user.click(screen.getByRole('button', { name: 'All Games' }))
    await waitFor(() => {
      expect(
        within(screen.getByTestId('library-grid')).getAllByRole('button', { name: /Open / })
      ).toHaveLength(3)
    })
  })

  it('sorts by playtime and uses recent activity as a tie-breaker', async () => {
    ipc.override('list_games', () => [
      {
        ...GAMES[0],
        name: 'Older Twin',
        totalPlaytimeSeconds: 3600,
        lastPlayedAt: '2026-06-01T12:00:00Z',
      },
      {
        ...GAMES[1],
        name: 'Newer Twin',
        totalPlaytimeSeconds: 3600,
        lastPlayedAt: '2026-06-15T12:00:00Z',
      },
      {
        ...GAMES[2],
        name: 'Low Playtime',
        totalPlaytimeSeconds: 60,
      },
    ])

    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Older Twin')
    await user.click(screen.getByRole('combobox', { name: 'Sort library' }))
    await user.click(screen.getByRole('option', { name: 'Total time' }))

    const sortedButtons = within(screen.getByTestId('library-grid')).getAllByRole('button', {
      name: /Open /,
    })
    expect(sortedButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Open Newer Twin',
      'Open Older Twin',
      'Open Low Playtime',
    ])
  })

  it('renders the empty state when the library has no games', async () => {
    ipc.override('list_games', () => [])
    renderWithProviders(<AppRoutes />, { route: '/library' })

    expect(await screen.findByTestId('library-empty')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your library is empty' })).toBeInTheDocument()
  })

  it('renders the search-empty state when filtering removes all games', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.type(screen.getByRole('searchbox', { name: 'Search games' }), 'zzz')

    expect(
      await screen.findByRole('heading', { name: 'No games match this search' })
    ).toBeInTheDocument()
  })

  it('renders the loading skeleton while the games query is pending', async () => {
    ipc.override(
      'list_games',
      () =>
        new Promise<Game[]>((_resolve) => {
          // Intentionally unresolved so the loading surface remains visible.
        })
    )

    renderWithProviders(<AppRoutes />, { route: '/library' })

    expect(await screen.findByTestId('library-loading')).toBeInTheDocument()
    expect(screen.getByLabelText('Loading library')).toBeInTheDocument()
  })

  it('wires the Add Game entry point to the overlay store state', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Add Game' }))

    expect(useUiStore.getState().activeOverlay).toBe('wizard')
  })

  it('opens the detail modal from a game card', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Alan Wake 2')
    await user.click(screen.getByRole('button', { name: 'Open Alan Wake 2' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('tab', { name: 'Overview' })).toBeInTheDocument()
    expect(useUiStore.getState().activeOverlay).toBe('detail')
    expect(useUiStore.getState().selectedGameId).toBe(1)
  })
})
