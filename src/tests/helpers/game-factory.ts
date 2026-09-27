import type { Game } from '@/types/domain'

/** Build a `Game` row for tests; override only the fields a test cares about. */
export function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 1,
    name: 'Alan Wake 2',
    launchTarget: 'C:/Games/AlanWake2.exe',
    monitorMode: 'tree',
    groupIds: [],
    scriptIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    totalPlaytimeSeconds: 0,
    ...overrides,
  }
}
