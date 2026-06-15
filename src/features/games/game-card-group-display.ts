import type { Group } from '@/types/domain'

export interface GameCardGroupDisplay {
  visibleGroups: Group[]
  overflowCount: number
}

/** Resolve up to four group pills for a library card (3 + overflow when needed). */
export function resolveGameCardGroups(
  groupIds: number[],
  groups: Group[]
): GameCardGroupDisplay {
  const resolved = groupIds
    .map((id) => groups.find((group) => group.id === id))
    .filter((group): group is Group => group !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name))

  if (resolved.length <= 4) {
    return { visibleGroups: resolved, overflowCount: 0 }
  }

  return {
    visibleGroups: resolved.slice(0, 3),
    overflowCount: resolved.length - 3,
  }
}
