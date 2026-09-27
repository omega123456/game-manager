import type { Game } from '@/types/domain'

/** Which half of the library is shown. */
export type InstallFilter = 'installed' | 'notInstalled'

/** Whether a game's launch target was present at the last install check. */
export function isGameInstalled(game: Pick<Game, 'missingReason'>): boolean {
  return game.missingReason === undefined
}

/** Split games into installed and not-installed lists, preserving order. */
export function partitionByInstall<T extends Pick<Game, 'missingReason'>>(
  games: readonly T[]
): { installed: T[]; notInstalled: T[] } {
  const installed: T[] = []
  const notInstalled: T[] = []
  for (const game of games) {
    if (isGameInstalled(game)) {
      installed.push(game)
    } else {
      notInstalled.push(game)
    }
  }
  return { installed, notInstalled }
}

/** Whether `game` belongs to the given library segment. */
export function matchesInstallFilter(
  game: Pick<Game, 'missingReason'>,
  filter: InstallFilter
): boolean {
  return isGameInstalled(game) === (filter === 'installed')
}

/**
 * The drive (`E:`) or network share (`\nas\games`) a launch target lives on,
 * or `null` when the target is not a drive or UNC path.
 */
export function missingRootLabel(launchTarget: string): string | null {
  const target = launchTarget.trim()
  const drive = /^([a-z]):[\\/]/i.exec(target)
  if (drive) {
    return `${drive[1].toUpperCase()}:`
  }
  const share = /^(?:\\\\|\/\/)([^\\/]+)[\\/]([^\\/]+)/.exec(target)
  if (share && share[1] !== '?' && share[1] !== '.') {
    return `\\\\${share[1]}\\${share[2]}`
  }
  return null
}

/** Format `lastSeenInstalledAt` as e.g. "12 Aug 2026", or `null` when unknown. */
export function formatLastSeenInstalled(lastSeenInstalledAt?: string): string | null {
  if (!lastSeenInstalledAt) {
    return null
  }
  const parsed = new Date(lastSeenInstalledAt)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed)
}
