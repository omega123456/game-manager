import { formatPlaytime } from '@/lib/format'

/** Format the last-played timestamp for compact library metadata. */
export function formatLastPlayed(lastPlayedAt?: string): string {
  if (!lastPlayedAt) {
    return 'Never launched'
  }

  const parsed = new Date(lastPlayedAt)
  if (Number.isNaN(parsed.getTime())) {
    return 'Never launched'
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed)
}

/** Shared label pair for a library card. */
export function getLibraryMeta(totalPlaytimeSeconds: number, lastPlayedAt?: string) {
  return {
    playtime: formatPlaytime(totalPlaytimeSeconds),
    lastPlayed: formatLastPlayed(lastPlayedAt),
  }
}
