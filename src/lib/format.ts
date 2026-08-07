/**
 * Small pure formatting helpers. Trivial, fully-tested smoke utilities that keep
 * the coverage gate exercised from Phase A1 onward.
 */

/**
 * Past this many hours the minutes component is dropped — a single session no
 * longer moves the number, so the extra precision is noise on a card.
 */
const PLAYTIME_MINUTES_CUTOFF_HOURS = 100

const hoursFormatter = new Intl.NumberFormat('en-GB')

type DurationParts = { hours?: number; minutes?: number }

type DurationFormatLike = { format(parts: DurationParts): string }

type DurationFormatConstructor = new (
  locale: string,
  options: { style: 'short' }
) => DurationFormatLike

let durationFormatter: DurationFormatLike | null | undefined

/**
 * `Intl.DurationFormat` handles pluralisation and thousands-grouping for us, but
 * it only landed in Chromium 129 — older WebView2 runtimes fall back to
 * {@link formatDurationParts}'s manual assembly rather than throwing.
 */
function getDurationFormatter(): DurationFormatLike | null {
  if (durationFormatter === undefined) {
    const DurationFormat = (Intl as { DurationFormat?: DurationFormatConstructor }).DurationFormat
    durationFormatter = DurationFormat ? new DurationFormat('en-GB', { style: 'short' }) : null
  }
  return durationFormatter
}

/** Render `{ hours, minutes }` in the platform's short duration style. */
function formatDurationParts(parts: DurationParts): string {
  const formatter = getDurationFormatter()
  if (formatter) {
    return formatter.format(parts)
  }
  const segments: string[] = []
  if (parts.hours !== undefined) {
    segments.push(`${hoursFormatter.format(parts.hours)} ${parts.hours === 1 ? 'hr' : 'hrs'}`)
  }
  if (parts.minutes !== undefined) {
    segments.push(`${parts.minutes} ${parts.minutes === 1 ? 'min' : 'mins'}`)
  }
  return segments.join(', ')
}

/** Format a number of seconds as a compact human-readable playtime label. */
export function formatPlaytime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return 'Never played'
  }
  const totalMinutes = Math.floor(totalSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) {
    return minutes > 0 ? formatDurationParts({ minutes }) : '<1 min'
  }
  if (minutes === 0 || hours >= PLAYTIME_MINUTES_CUTOFF_HOURS) {
    return formatDurationParts({ hours })
  }
  return formatDurationParts({ hours, minutes })
}

/** Clamp a number into the inclusive [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
