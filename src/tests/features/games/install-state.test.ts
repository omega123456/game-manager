import { describe, expect, it } from 'vitest'

import {
  formatLastSeenInstalled,
  isGameInstalled,
  matchesInstallFilter,
  missingRootLabel,
  partitionByInstall,
} from '@/features/games/install-state'
import { makeGame } from '@/tests/helpers/game-factory'

describe('install-state', () => {
  it('treats games without a missing reason as installed', () => {
    expect(isGameInstalled(makeGame())).toBe(true)
    expect(isGameInstalled(makeGame({ missingReason: 'fileMissing' }))).toBe(false)
    expect(isGameInstalled(makeGame({ missingReason: 'driveMissing' }))).toBe(false)
  })

  it('partitions games by install state and keeps their order', () => {
    const a = makeGame({ id: 1 })
    const b = makeGame({ id: 2, missingReason: 'fileMissing' })
    const c = makeGame({ id: 3 })

    expect(partitionByInstall([a, b, c])).toEqual({ installed: [a, c], notInstalled: [b] })
  })

  it('matches games against the active segment', () => {
    const installed = makeGame()
    const missing = makeGame({ missingReason: 'driveMissing' })

    expect(matchesInstallFilter(installed, 'installed')).toBe(true)
    expect(matchesInstallFilter(installed, 'notInstalled')).toBe(false)
    expect(matchesInstallFilter(missing, 'notInstalled')).toBe(true)
    expect(matchesInstallFilter(missing, 'installed')).toBe(false)
  })

  it('names the drive or share a launch target lives on', () => {
    expect(missingRootLabel('e:\\Games\\x.exe')).toBe('E:')
    expect(missingRootLabel('  C:/Games/x.exe ')).toBe('C:')
    expect(missingRootLabel('\\\\nas\\games\\x.exe')).toBe('\\\\nas\\games')
    expect(missingRootLabel('//nas/games/x.exe')).toBe('\\\\nas\\games')
    expect(missingRootLabel('\\\\?\\C:\\x.exe')).toBeNull()
    expect(missingRootLabel('steam://rungameid/1')).toBeNull()
    expect(missingRootLabel('game.exe')).toBeNull()
  })

  it('formats the last-seen timestamp and ignores missing or invalid values', () => {
    expect(formatLastSeenInstalled('2026-08-12T10:00:00Z')).toBe('12 Aug 2026')
    expect(formatLastSeenInstalled(undefined)).toBeNull()
    expect(formatLastSeenInstalled('not a date')).toBeNull()
  })
})
