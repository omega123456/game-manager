import { describe, expect, it } from 'vitest'

import { columnsForWidth } from '@/features/games/use-grid-columns'

describe('columnsForWidth', () => {
  it('clamps to a single column for non-positive widths', () => {
    expect(columnsForWidth(0)).toBe(1)
    expect(columnsForWidth(-50)).toBe(1)
  })

  it('returns one column when the width fits exactly one 220px track', () => {
    expect(columnsForWidth(220)).toBe(1)
    // Just under two tracks (220 + 16 + 220 = 456) still yields one column.
    expect(columnsForWidth(455)).toBe(1)
  })

  it('adds a column once a full track + gap fits', () => {
    // 220 + 16 + 220 = 456 -> exactly two columns.
    expect(columnsForWidth(456)).toBe(2)
    // 456 + 16 + 220 = 692 -> three columns.
    expect(columnsForWidth(692)).toBe(3)
  })

  it('matches the auto-fill, 220px track count for a wide container', () => {
    // 1200px: floor((1200 + 16) / 236) = floor(5.15) = 5 columns.
    expect(columnsForWidth(1200)).toBe(5)
  })
})
