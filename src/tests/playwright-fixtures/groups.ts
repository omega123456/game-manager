import type { Group } from '@/types/domain'

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

export const groupsFixtures: Record<string, PlaywrightFixtureHandler> = {
  list_groups: () => GROUP_ROWS,
  get_group: (args) => GROUP_ROWS.find((group) => group.id === args?.id) ?? null,
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
}
