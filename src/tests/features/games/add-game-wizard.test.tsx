import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { AppRoutes } from '@/routes/app-routes'
import { renderWithProviders, resetUiStore } from '@/tests/helpers/render-app'
import { ipc, overrideIpcCommands } from '@/tests/ipc-mock'
import type { ArtCandidate, Game } from '@/types/domain'

const EXISTING_GAMES: Game[] = [
  {
    id: 1,
    name: 'Balatro',
    launchTarget: 'C:/Games/Balatro.exe',
    monitorMode: 'tree',
    groupIds: [],
    scriptIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    totalPlaytimeSeconds: 2400,
  },
]

const ART_RESULTS: ArtCandidate[] = [
  {
    id: 'art-1',
    imageUrl: 'https://images.example.test/art-1.png',
    source: 'steamGridDb',
    width: 600,
    height: 900,
    providerName: 'SteamGridDB',
  },
  {
    id: 'art-2',
    imageUrl: 'https://images.example.test/art-2.png',
    source: 'steam',
    width: 600,
    height: 900,
    providerName: 'Steam',
  },
]

function installStatefulGameMocks() {
  const games = [...EXISTING_GAMES]
  let nextId = 2

  overrideIpcCommands({
    list_games: () => games.slice(),
    create_game: (args) => {
      const input = args?.input as Record<string, unknown>
      const created: Game = {
        id: nextId++,
        name: String(input.name),
        launchTarget: String(input.launchTarget),
        monitorMode: 'tree',
        arguments: (input.arguments as string | null | undefined) ?? undefined,
        imagePath: (input.imagePath as string | null | undefined) ?? undefined,
        groupIds: [],
        scriptIds: [],
        createdAt: '2026-06-15T12:00:00Z',
        totalPlaytimeSeconds: 0,
      }
      games.unshift(created)
      return created
    },
  })

  return games
}

describe('AddGameWizard', () => {
  beforeEach(() => {
    resetUiStore()
  })

  it('completes the full wizard flow, supports keyboard art selection, and refreshes the library', async () => {
    const games = installStatefulGameMocks()
    overrideIpcCommands({
      'plugin:dialog|open': (args) => {
        const options = args?.options as { filters?: Array<{ extensions?: string[] }> } | undefined
        const extensions = options?.filters?.flatMap((filter) => filter.extensions ?? []) ?? []
        return extensions.includes('exe') ? 'C:/Games/AlanWake2.exe' : null
      },
      fetch_metadata: () => ({ canonicalName: 'Alan Wake 2', source: 'steam' }),
      search_art: () => ART_RESULTS,
      cache_art_candidate: () => 'C:/Cache/alan-wake-2.png',
    })

    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Balatro')
    await user.click(screen.getByRole('button', { name: 'Add Game' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browse for executable' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Browse for executable' }))
    expect(screen.getByText('C:/Games/AlanWake2.exe')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue to cover art' }))

    expect(await screen.findByText('Step 2 of 3')).toBeInTheDocument()
    const grid = await screen.findByTestId('art-candidate-grid')
    const options = within(grid).getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    options[0].focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => {
      expect(options[1]).toHaveAttribute('aria-selected', 'true')
    })

    await user.click(screen.getByRole('button', { name: 'Continue to details' }))

    expect(await screen.findByText('Step 3 of 3')).toBeInTheDocument()
    const nameInput = screen.getByLabelText('Game name')
    expect(nameInput).toHaveFocus()
    expect(nameInput).toHaveValue('Alan Wake 2')

    await user.click(screen.getByRole('button', { name: 'Save game' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(games[0]?.name).toBe('Alan Wake 2')
    expect(ipc.calls('create_game')[0]).toEqual({
      input: {
        name: 'Alan Wake 2',
        launchTarget: 'C:/Games/AlanWake2.exe',
        monitorMode: 'tree',
        arguments: null,
        imagePath: 'C:/Cache/alan-wake-2.png',
      },
    })
    expect(await screen.findByText('Alan Wake 2')).toBeInTheDocument()
  })

  it('supports the no-results branch and can continue without cover art', async () => {
    installStatefulGameMocks()
    overrideIpcCommands({
      'plugin:dialog|open': () => 'C:/Games/Cocoon.exe',
      fetch_metadata: () => ({ canonicalName: 'Cocoon', source: 'input' }),
      search_art: () => [],
    })

    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Balatro')
    await user.click(screen.getByRole('button', { name: 'Add Game' }))
    await user.click(screen.getByRole('button', { name: 'Browse for executable' }))
    await user.click(screen.getByRole('button', { name: 'Continue to cover art' }))

    expect(
      await screen.findByText(
        'No cover art matched this search. Try another title or use a local file.'
      )
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue without cover' }))
    await user.click(screen.getByRole('button', { name: 'Save game' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(ipc.calls('create_game')[0]).toEqual({
      input: {
        name: 'Cocoon',
        launchTarget: 'C:/Games/Cocoon.exe',
        monitorMode: 'tree',
        arguments: null,
        imagePath: null,
      },
    })
  })

  it('blocks advancing when caching a remote candidate returns no path', async () => {
    installStatefulGameMocks()
    overrideIpcCommands({
      'plugin:dialog|open': () => 'C:/Games/AlanWake2.exe',
      fetch_metadata: () => ({ canonicalName: 'Alan Wake 2', source: 'steam' }),
      search_art: () => ART_RESULTS,
      cache_art_candidate: () => null,
    })

    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Balatro')
    await user.click(screen.getByRole('button', { name: 'Add Game' }))
    await user.click(screen.getByRole('button', { name: 'Browse for executable' }))
    await user.click(screen.getByRole('button', { name: 'Continue to cover art' }))

    await screen.findByTestId('art-candidate-grid')
    await user.click(screen.getByRole('button', { name: 'Continue to details' }))

    expect(
      await screen.findByText(
        'Could not cache the selected cover art. Try another image or use a local file.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText('Step 3 of 3')).not.toBeInTheDocument()
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument()
  })

  it('ignores a stale art response when a newer search resolves first', async () => {
    installStatefulGameMocks()
    let resolveFirst: (value: ArtCandidate[]) => void = () => {}
    const firstResponse = new Promise<ArtCandidate[]>((resolve) => {
      resolveFirst = resolve
    })
    const staleResults: ArtCandidate[] = [
      {
        id: 'stale-art',
        imageUrl: 'https://images.example.test/stale.png',
        source: 'steam',
        width: 600,
        height: 900,
        providerName: 'StaleProvider',
      },
    ]
    let searchCalls = 0

    overrideIpcCommands({
      'plugin:dialog|open': () => 'C:/Games/AlanWake2.exe',
      fetch_metadata: (args) => ({ canonicalName: String(args?.name ?? ''), source: 'input' }),
      search_art: () => {
        searchCalls += 1
        return searchCalls === 1 ? firstResponse : ART_RESULTS
      },
    })

    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Balatro')
    await user.click(screen.getByRole('button', { name: 'Add Game' }))
    await user.click(screen.getByRole('button', { name: 'Browse for executable' }))
    await user.click(screen.getByRole('button', { name: 'Continue to cover art' }))

    // First (pending) search kicks off on entering step 2. Trigger a newer one.
    const searchInput = await screen.findByLabelText('Search title')
    await user.clear(searchInput)
    await user.type(searchInput, 'Hades II')

    // Newer search resolves first and populates the grid.
    const grid = await screen.findByTestId('art-candidate-grid')
    await waitFor(() => {
      expect(within(grid).getAllByRole('option')).toHaveLength(ART_RESULTS.length)
    })

    // Now the older request resolves — it must not overwrite the newer results.
    resolveFirst(staleResults)
    await waitFor(() => {
      expect(searchCalls).toBeGreaterThanOrEqual(2)
    })
    expect(within(grid).getAllByRole('option')).toHaveLength(ART_RESULTS.length)
    expect(screen.queryByText('StaleProvider')).not.toBeInTheDocument()
  })

  it('supports the local-file branch and saves the selected image path', async () => {
    installStatefulGameMocks()
    overrideIpcCommands({
      'plugin:dialog|open': (args) => {
        const options = args?.options as { filters?: Array<{ extensions?: string[] }> } | undefined
        const extensions = options?.filters?.flatMap((filter) => filter.extensions ?? []) ?? []
        if (extensions.includes('exe')) {
          return 'C:/Games/Hades2.exe'
        }
        return 'C:/Users/Test/Pictures/hades-2-cover.png'
      },
      fetch_metadata: () => ({ canonicalName: 'Hades II', source: 'steam' }),
      search_art: () => [],
    })

    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/library' })

    await screen.findByText('Balatro')
    await user.click(screen.getByRole('button', { name: 'Add Game' }))
    await user.click(screen.getByRole('button', { name: 'Browse for executable' }))
    await user.click(screen.getByRole('button', { name: 'Continue to cover art' }))

    await user.click(screen.getByRole('button', { name: 'Use Local File' }))
    expect(await screen.findByText('Local cover selected: hades-2-cover.png')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue to details' }))
    expect(await screen.findByDisplayValue('Hades II')).toBeInTheDocument()
    expect(screen.getByText('hades-2-cover.png')).toBeInTheDocument()

    const preview = screen.getByAltText('Hades II cover preview') as HTMLImageElement
    expect(preview).toBeInTheDocument()
    expect(preview.getAttribute('src')).toContain('asset.localhost')
    expect(screen.queryByText('No cover selected')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save game' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(ipc.calls('create_game')[0]).toEqual({
      input: {
        name: 'Hades II',
        launchTarget: 'C:/Games/Hades2.exe',
        monitorMode: 'tree',
        arguments: null,
        imagePath: 'C:/Users/Test/Pictures/hades-2-cover.png',
      },
    })
  })
})
