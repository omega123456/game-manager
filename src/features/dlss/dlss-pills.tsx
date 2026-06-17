import { cn } from '@/lib/utils'
import { DLL_TYPE_ABBR, DLL_TYPES, type DetectedDll, type GameDlssState } from '@/types/dlss'

export interface DlssPillsProps {
  /** Cached DLSS detection state for this game, if any. */
  state?: GameDlssState
  /** True when the "Playing" pip occupies the top-right slot. */
  hasPlayingPip?: boolean
}

/** Abbreviate a detected version to `major.minor` (e.g. `3.7.10` → `3.7`). */
function abbreviateVersion(version: string): string {
  const parts = version.split('.')
  if (parts.length <= 2) {
    return version
  }
  return `${parts[0]}.${parts[1]}`
}

/** Read the detected DLL for a type off the cached state. */
function detectedFor(
  state: GameDlssState,
  type: (typeof DLL_TYPES)[number]
): DetectedDll | undefined {
  switch (type) {
    case 'superResolution':
      return state.superResolution
    case 'frameGeneration':
      return state.frameGeneration
    case 'rayReconstruction':
      return state.rayReconstruction
  }
}

/**
 * Up-to-three version pills (SR / FG / RR) rendered from cached detection. A pill
 * is omitted when its DLL is not detected; nothing renders when the game has no
 * detected DLLs (not installed). Decorative (`aria-hidden`). When the "Playing"
 * pip occupies the top-right corner, the stack is offset below it so they stack
 * rather than overlap.
 */
export function DlssPills({
  state,
  hasPlayingPip = false,
}: DlssPillsProps): React.JSX.Element | null {
  if (!state) {
    return null
  }

  const pills = DLL_TYPES.map((type) => {
    const detected = detectedFor(state, type)
    if (!detected) {
      return null
    }
    return { type, version: abbreviateVersion(detected.version) }
  }).filter((pill): pill is { type: (typeof DLL_TYPES)[number]; version: string } => pill !== null)

  if (pills.length === 0) {
    return null
  }

  return (
    <div
      aria-hidden
      data-testid="dlss-pills"
      className={cn(
        'pointer-events-none absolute right-3 z-10 flex flex-col items-end gap-1',
        hasPlayingPip ? 'top-12' : 'top-3'
      )}
    >
      {pills.map((pill) => (
        <span
          key={pill.type}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background/80 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground backdrop-blur"
        >
          {DLL_TYPE_ABBR[pill.type]} {pill.version}
        </span>
      ))}
    </div>
  )
}
