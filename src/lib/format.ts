/**
 * Small pure formatting helpers. Trivial, fully-tested smoke utilities that keep
 * the coverage gate exercised from Phase A1 onward.
 */

/** Format a number of seconds as a compact human-readable playtime label. */
export function formatPlaytime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return 'Never played'
  }
  const hours = totalSeconds / 3600
  if (hours >= 1) {
    return `${hours.toFixed(1)} hrs`
  }
  const minutes = Math.round(totalSeconds / 60)
  return `${minutes} min`
}

/** Clamp a number into the inclusive [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
