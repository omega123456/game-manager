import type { Game } from '@/types/domain'

import type { PlaywrightFixtureHandler } from './index'

export const GAME_ROWS: Game[] = [
  {
    id: 1,
    name: 'Alan Wake 2',
    launchTarget: 'C:/Games/AlanWake2.exe',
    monitorMode: 'tree',
    createdAt: '2026-01-01T00:00:00Z',
    imagePath: 'https://images.example.test/alan-wake-2.png',
    groupIds: [1],
    scriptIds: [2],
    totalPlaytimeSeconds: 8420,
    lastPlayedAt: '2026-06-14T21:00:00Z',
  },
  {
    id: 2,
    name: 'Balatro',
    launchTarget: 'C:/Games/Balatro.exe',
    monitorMode: 'named',
    monitorProcessName: 'Balatro.exe',
    createdAt: '2026-01-02T00:00:00Z',
    imagePath: 'https://images.example.test/balatro.png',
    groupIds: [2],
    scriptIds: [],
    totalPlaytimeSeconds: 24010,
    lastPlayedAt: '2026-06-13T20:00:00Z',
  },
  {
    id: 3,
    name: 'Cocoon',
    launchTarget: 'C:/Games/Cocoon.exe',
    monitorMode: 'tree',
    createdAt: '2026-01-03T00:00:00Z',
    groupIds: [],
    scriptIds: [],
    totalPlaytimeSeconds: 0,
  },
  {
    id: 4,
    name: 'Hades II',
    launchTarget: 'C:/Games/Hades2.exe',
    monitorMode: 'tree',
    createdAt: '2026-01-04T00:00:00Z',
    imagePath: 'https://images.example.test/hades-2.png',
    groupIds: [1],
    scriptIds: [],
    totalPlaytimeSeconds: 1800,
    lastPlayedAt: '2026-05-21T19:30:00Z',
  },
]

function getLibraryFixtureState(): 'grid' | 'empty' | 'loading' {
  if (typeof window === 'undefined') {
    return 'grid'
  }

  const [, search = ''] = window.location.hash.split('?')
  const params = new URLSearchParams(search)
  const state = params.get('libraryFixture')
  return state === 'empty' || state === 'loading' ? state : 'grid'
}

export const gamesFixtures: Record<string, PlaywrightFixtureHandler> = {
  list_games: () => {
    const state = getLibraryFixtureState()
    if (state === 'empty') {
      return []
    }
    if (state === 'loading') {
      return new Promise<Game[]>((resolve) => {
        window.setTimeout(() => resolve(GAME_ROWS), 300)
      })
    }
    return GAME_ROWS
  },
  get_play_now_game: () => {
    const state = getLibraryFixtureState()
    if (state === 'empty') {
      return null
    }
    return GAME_ROWS[0]
  },
  get_game: (args) => GAME_ROWS.find((game) => game.id === args?.id) ?? null,
  create_game: (args) => ({
    id: 99,
    groupIds: [],
    scriptIds: [],
    createdAt: '2026-01-02T00:00:00Z',
    totalPlaytimeSeconds: 0,
    ...(args?.input as object),
  }),
  update_game: (args) => ({
    id: args?.id ?? 1,
    groupIds: [],
    scriptIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    totalPlaytimeSeconds: 0,
    ...(args?.input as object),
  }),
  delete_game: () => undefined,
  set_game_groups: (args) => args?.groupIds ?? [],
  set_game_scripts: (args) => args?.scriptIds ?? [],
  get_resolved_scripts: (args) => {
    const gameId = Number(args?.gameId ?? 0)
    if (gameId === 1) {
      return [
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
          scriptId: 1,
          name: 'HDR Toggle',
          priority: 8,
          phase: 'before',
          provenance: 'global',
          order: 2,
          requiredUtilityNames: ['SaveLib'],
        },
        {
          scriptId: 1,
          name: 'HDR Toggle',
          priority: 8,
          phase: 'onExit',
          provenance: 'global',
          order: 1,
          requiredUtilityNames: ['SaveLib'],
        },
      ]
    }
    return []
  },
}
