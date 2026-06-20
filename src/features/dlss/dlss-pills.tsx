import { cn } from '@/lib/utils'
import {
  DLL_TYPE_ABBR,
  DLL_TYPES,
  type DetectedDll,
  type DllCatalog,
  type DllType,
  type GameDlssState,
  type PresetOption,
} from '@/types/dlss'

export interface DlssPillsProps {
  /** Cached DLSS detection state for this game, if any. */
  state?: GameDlssState
  /** True when the "Playing" pip occupies the top-right slot. */
  hasPlayingPip?: boolean
  /**
   * Resolved version catalog, used to color each pill by freshness (green when
   * the detected version is the latest available for its type, amber otherwise).
   * When absent, pills fall back to neutral styling.
   */
  catalog?: DllCatalog
  /**
   * Bundled SR preset options, used to render the override letter next to the
   * Super Resolution pill (e.g. `Preset E` → `(E)`). Default / non-lettered
   * presets render no letter.
   */
  srPresetOptions?: PresetOption[]
}

/** Freshness of a detected DLL relative to the catalog. */
type PillTone = 'latest' | 'outdated' | 'unknown'

/** Abbreviate a detected version to `major.minor` (e.g. `3.7.10` → `3.7`). */
function abbreviateVersion(version: string): string {
  const parts = version.split('.')
  if (parts.length <= 2) {
    return version
  }
  return `${parts[0]}.${parts[1]}`
}

/** Read the detected DLL for a type off the cached state. */
function detectedFor(state: GameDlssState, type: DllType): DetectedDll | undefined {
  switch (type) {
    case 'superResolution':
      return state.superResolution
    case 'frameGeneration':
      return state.frameGeneration
    case 'rayReconstruction':
      return state.rayReconstruction
  }
}

/** The catalog versions for a type (catalog is sorted newest-first). */
function catalogVersionsFor(catalog: DllCatalog, type: DllType) {
  switch (type) {
    case 'superResolution':
      return catalog.superResolution
    case 'frameGeneration':
      return catalog.frameGeneration
    case 'rayReconstruction':
      return catalog.rayReconstruction
  }
}

/**
 * Classify a detected version as the latest in the catalog or outdated. Returns
 * `unknown` when no catalog (or no catalog entries for the type) is available.
 */
function toneFor(
  catalog: DllCatalog | undefined,
  type: DllType,
  detectedVersion: string
): PillTone {
  if (!catalog) {
    return 'unknown'
  }
  const latest = catalogVersionsFor(catalog, type)[0]?.version
  if (latest === undefined) {
    return 'unknown'
  }
  return detectedVersion === latest ? 'latest' : 'outdated'
}

/**
 * Resolve the single-letter SR preset override from the cached value, or `null`
 * when there is none to show (no value, Default, or a non-lettered preset name
 * such as "NVIDIA recommended").
 */
function srPresetLetter(
  value: number | undefined,
  options: PresetOption[] | undefined
): string | null {
  if (value === undefined || value === 0 || !options) {
    return null
  }
  const name = options.find((option) => option.value === value)?.name
  const match = name?.match(/^Preset\s+(\S+)$/)
  return match ? match[1] : null
}

const TONE_CLASSES: Record<PillTone, string> = {
  latest: 'border-success/50 text-success',
  outdated: 'border-warning/50 text-warning',
  unknown: 'border-border text-foreground',
}

/**
 * Up-to-three version pills (SR / FG / RR) rendered from cached detection. A pill
 * is omitted when its DLL is not detected; nothing renders when the game has no
 * detected DLLs (not installed). Each pill is color-coded by freshness against the
 * catalog (green = latest, amber = outdated). The SR pill additionally shows the
 * per-game preset override letter in brackets when one is set. Decorative
 * (`aria-hidden`). When the "Playing" pip occupies the top-right corner, the stack
 * is offset below it so they stack rather than overlap.
 */
export function DlssPills({
  state,
  hasPlayingPip = false,
  catalog,
  srPresetOptions,
}: DlssPillsProps): React.JSX.Element | null {
  if (!state) {
    return null
  }

  const presetLetter = srPresetLetter(state.srPreset, srPresetOptions)

  const pills = DLL_TYPES.map((type) => {
    const detected = detectedFor(state, type)
    if (!detected) {
      return null
    }
    const letter = type === 'superResolution' ? presetLetter : null
    return {
      type,
      version: abbreviateVersion(detected.version),
      tone: toneFor(catalog, type, detected.version),
      letter,
    }
  }).filter((pill): pill is NonNullable<typeof pill> => pill !== null)

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
          data-tone={pill.tone}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border bg-background/80 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] backdrop-blur',
            TONE_CLASSES[pill.tone]
          )}
        >
          {DLL_TYPE_ABBR[pill.type]} {pill.version}
          {pill.letter ? ` (${pill.letter})` : ''}
        </span>
      ))}
    </div>
  )
}
