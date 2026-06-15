import type { LaunchPhase } from '@/types/domain'

/** Format a whole number of seconds as a zero-padded `mm:ss` (or `h:mm:ss`). */
export function formatElapsed(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  if (hours > 0) {
    return `${hours}:${mm}:${ss}`
  }
  return `${mm}:${ss}`
}

/** Format a logged session duration (seconds) as a compact `Xh Ym` summary. */
export function formatLoggedPlaytime(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m`
  }
  const seconds = safe % 60
  return `${seconds}s`
}

/** Short, human label for a live launch phase, used by the banner heading. */
export function phaseLabel(phase: LaunchPhase): string {
  switch (phase) {
    case 'before':
      return 'Preparing'
    case 'waitingForProcess':
      return 'Launching'
    case 'playing':
      return 'Playing'
    case 'onExit':
      return 'Cleaning up'
    case 'ended':
      return 'Session ended'
    default:
      return 'Preparing'
  }
}
