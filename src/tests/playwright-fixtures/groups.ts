import type { Group } from '@/types/domain'

import { getLibraryFixtureState } from './games'
import type { PlaywrightFixtureHandler } from './index'

export const GROUP_ROWS: Group[] = [
  {
    id: 1,
    name: 'HDR Games',
    description: 'Shared HDR setup',
    scriptIds: [2],
    gameIds: [1, 4],
  },
  {
    id: 2,
    name: 'Deck Verified',
    description: 'Handheld-friendly tweaks',
    scriptIds: [],
    gameIds: [2],
  },
]

/** Group rows for the current library scenario (Control joins HDR Games when not installed). */
function groupRows(): Group[] {
  if (getLibraryFixtureState() !== 'notInstalled') {
    return GROUP_ROWS
  }
  return GROUP_ROWS.map((group) =>
    group.id === 1 ? { ...group, gameIds: [...group.gameIds, 5] } : group
  )
}

export const groupsFixtures: Record<string, PlaywrightFixtureHandler> = {
  list_groups: () => groupRows(),
  get_group: (args) => groupRows().find((group) => group.id === args?.id) ?? null,
  create_group: (args) => ({
    id: 99,
    scriptIds: [],
    gameIds: [],
    ...(args?.input as object),
  }),
  update_group: (args) => ({
    id: args?.id ?? 1,
    scriptIds: [],
    gameIds: [],
    ...(args?.input as object),
  }),
  delete_group: () => undefined,
  set_group_scripts: (args) => args?.scriptIds ?? [],
  set_group_games: (args) => args?.gameIds ?? [],
}
