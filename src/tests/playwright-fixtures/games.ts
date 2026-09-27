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

/** Games whose launch target is missing, used by the not-installed scenarios. */
export const NOT_INSTALLED_ROWS: Game[] = [
  {
    id: 5,
    name: 'Control',
    launchTarget: 'C:/Games/Control/Control.exe',
    monitorMode: 'tree',
    createdAt: '2026-01-05T00:00:00Z',
    groupIds: [1],
    scriptIds: [],
    totalPlaytimeSeconds: 93600,
    lastPlayedAt: '2026-01-20T19:00:00Z',
    missingReason: 'fileMissing',
    lastSeenInstalledAt: '2026-08-12T10:00:00Z',
  },
  {
    id: 6,
    name: 'Death Stranding',
    launchTarget: 'E:/Games/DeathStranding/ds.exe',
    monitorMode: 'tree',
    createdAt: '2026-01-06T00:00:00Z',
    groupIds: [],
    scriptIds: [],
    totalPlaytimeSeconds: 219600,
    lastPlayedAt: '2025-11-02T21:00:00Z',
    missingReason: 'driveMissing',
    lastSeenInstalledAt: '2026-07-02T18:00:00Z',
  },
]

export type LibraryFixtureState = 'grid' | 'empty' | 'loading' | 'notInstalled' | 'noneInstalled'

const LIBRARY_FIXTURE_STATES: readonly LibraryFixtureState[] = [
  'empty',
  'loading',
  'notInstalled',
  'noneInstalled',
]

/** The `libraryFixture` scenario from the URL hash (`#/library?libraryFixture=...`). */
export function getLibraryFixtureState(): LibraryFixtureState {
  if (typeof window === 'undefined') {
    return 'grid'
  }

  const [, search = ''] = window.location.hash.split('?')
  const params = new URLSearchParams(search)
  const state = params.get('libraryFixture')
  return LIBRARY_FIXTURE_STATES.find((candidate) => candidate === state) ?? 'grid'
}

/** The game rows served for the current library scenario. */
function libraryRows(): Game[] {
  switch (getLibraryFixtureState()) {
    case 'empty':
      return []
    case 'notInstalled':
      return [...GAME_ROWS, ...NOT_INSTALLED_ROWS]
    case 'noneInstalled':
      return NOT_INSTALLED_ROWS
    default:
      return GAME_ROWS
  }
}

export const gamesFixtures: Record<string, PlaywrightFixtureHandler> = {
  list_games: () => {
    if (getLibraryFixtureState() === 'loading') {
      return new Promise<Game[]>((resolve) => {
        window.setTimeout(() => resolve(GAME_ROWS), 300)
      })
    }
    return libraryRows()
  },
  get_play_now_game: () => {
    const state = getLibraryFixtureState()
    if (state === 'empty' || state === 'noneInstalled') {
      return null
    }
    return GAME_ROWS[0]
  },
  get_game: (args) =>
    [...GAME_ROWS, ...NOT_INSTALLED_ROWS].find((game) => game.id === args?.id) ?? null,
  recheck_installs: () => {
    const rows = libraryRows()
    return {
      checked: rows.length,
      missingGameIds: rows.filter((game) => game.missingReason).map((game) => game.id),
      changedGameIds: [],
      restoredGameIds: [],
    }
  },
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
