import { describe, expect, it } from 'vitest'

import { resolveGameCardGroups } from '@/features/games/game-card-group-display'
import type { Group } from '@/types/domain'

const GROUPS: Group[] = [
  { id: 1, name: 'Alpha', scriptIds: [], gameIds: [] },
  { id: 2, name: 'Bravo', scriptIds: [], gameIds: [] },
  { id: 3, name: 'Charlie', scriptIds: [], gameIds: [] },
  { id: 4, name: 'Delta', scriptIds: [], gameIds: [] },
  { id: 5, name: 'Echo', scriptIds: [], gameIds: [] },
  { id: 6, name: 'Foxtrot', scriptIds: [], gameIds: [] },
]

describe('resolveGameCardGroups', () => {
  it('returns no groups when membership is empty', () => {
    expect(resolveGameCardGroups([], GROUPS)).toEqual({
      visibleGroups: [],
      overflowCount: 0,
    })
  })

  it('shows all groups when there are four or fewer', () => {
    const result = resolveGameCardGroups([4, 2, 3, 1], GROUPS)

    expect(result.overflowCount).toBe(0)
    expect(result.visibleGroups.map((group) => group.name)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
      'Delta',
    ])
  })

  it('shows three groups and an overflow count when there are more than four', () => {
    const result = resolveGameCardGroups([6, 5, 4, 3, 2, 1], GROUPS)

    expect(result.visibleGroups.map((group) => group.name)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(result.overflowCount).toBe(3)
  })

  it('ignores unknown group ids', () => {
    const result = resolveGameCardGroups([99, 2, 1], GROUPS)

    expect(result.visibleGroups.map((group) => group.name)).toEqual(['Alpha', 'Bravo'])
    expect(result.overflowCount).toBe(0)
  })
})
