/**
 * Playwright fixtures for the DLSS domain.
 *
 * Provides deterministic catalog / state / preset responses so the DLSS
 * Management page renders stable screenshots in the VITE_PLAYWRIGHT web build.
 * All fixture data lives here (not inline in the mock router) and is wired via
 * the registry index.
 */
import type {
  BatchApplyResult,
  DllCatalog,
  DllVersion,
  DlssIndicatorMode,
  DlssScanStatus,
  DlssSupport,
  GameDlssState,
  GamePresetState,
  PresetOption,
} from '@/types/dlss'

import type { PlaywrightFixtureHandler } from './index'

function srVersion(version: string, label: string, isDownloaded: boolean): DllVersion {
  return {
    type: 'superResolution',
    version,
    versionNumber: Number(version.replace(/\./g, '')),
    label,
    md5: `md5-sr-${version}`,
    zipMd5: `zip-sr-${version}`,
    downloadUrl: `https://example.test/sr/${version}.zip`,
    fileSizeBytes: 28_000_000,
    zipSizeBytes: 45_000_000,
    isSignatureValid: true,
    isDownloaded,
  }
}

export const DLSS_CATALOG: DllCatalog = {
  superResolution: [
    srVersion('3.7.10', 'v3.7.10 (Latest)', true),
    srVersion('3.5.10', 'v3.5.10', true),
    srVersion('3.8.0', 'v3.8.0 (New)', false),
    srVersion('2.5.1', 'v2.5.1', false),
  ],
  frameGeneration: [
    { ...srVersion('3.8.0', 'v3.8.0 (New)', false), type: 'frameGeneration' },
    { ...srVersion('1.1.0', 'v1.1.0', true), type: 'frameGeneration' },
  ],
  rayReconstruction: [{ ...srVersion('3.5.0', 'v3.5.0', true), type: 'rayReconstruction' }],
  source: 'static',
  fetchedAt: '2026-06-17T00:00:00.000Z',
}

export const DLSS_SUPPORT: DlssSupport = {
  nvapiAvailable: true,
  isElevated: true,
}

export const DLSS_GAME_STATES: GameDlssState[] = [
  {
    gameId: 1,
    folderResolved: 'D:\\Games\\Elden Ring',
    // Latest SR (3.7.10) + a non-default SR preset → green pill with "(E)".
    superResolution: { version: '3.7.10', path: 'D:\\Games\\Elden Ring\\nvngx_dlss.dll' },
    frameGeneration: { version: '1.1.0', path: 'D:\\Games\\Elden Ring\\nvngx_dlssg.dll' },
    srPreset: 5,
    lastScannedAt: '2026-06-17T00:00:00.000Z',
    stale: false,
  },
  {
    gameId: 2,
    folderResolved: 'D:\\Games\\Cyber Nova 2077',
    // Outdated SR (3.5.10) + Default preset → amber pill, no letter.
    superResolution: { version: '3.5.10', path: 'D:\\Games\\Cyber Nova 2077\\nvngx_dlss.dll' },
    rayReconstruction: {
      version: '3.5.0',
      path: 'D:\\Games\\Cyber Nova 2077\\nvngx_dlssd.dll',
    },
    lastScannedAt: '2026-06-17T00:00:00.000Z',
    stale: false,
  },
  {
    // Not-installed case: no DLLs detected → no pills on the card.
    gameId: 3,
    folderResolved: 'D:\\Games\\Pixel Drifter',
    lastScannedAt: '2026-06-17T00:00:00.000Z',
    stale: false,
  },
]

const SR_PRESET_OPTIONS: PresetOption[] = [
  { value: 0, name: 'Default', deprecated: false },
  { value: 1, name: 'Preset A', deprecated: false },
  { value: 5, name: 'Preset E', deprecated: false },
  { value: 0x00ffffff, name: 'NVIDIA recommended', deprecated: false },
]

const RR_PRESET_OPTIONS: PresetOption[] = [
  { value: 0, name: 'Default', deprecated: false },
  { value: 1, name: 'Preset A', deprecated: true },
  { value: 4, name: 'Preset D', deprecated: false },
  { value: 0x00ffffff, name: 'NVIDIA recommended', deprecated: false },
]

const GAME_PRESET_STATE: GamePresetState = { available: true, value: 0 }

/** Per-game preset availability: game 1 has a matching profile, game 2 does not. */
function gamePresetState(gameId: number): GamePresetState {
  if (gameId === 2) {
    return { available: false, value: 0 }
  }
  return GAME_PRESET_STATE
}

const BATCH_RESULT: BatchApplyResult = {
  total: 2,
  succeeded: 2,
  failed: 0,
  results: DLSS_GAME_STATES.map((state) => ({
    gameId: state.gameId,
    name: state.gameId === 1 ? 'Elden Ring' : 'Cyber Nova 2077',
    ok: true,
    message: 'Updated to 3.7.10',
  })),
}

/** A mixed-outcome batch (some succeeded, some failed) for the result dialog. */
const BATCH_RESULT_WITH_FAILURES: BatchApplyResult = {
  total: 4,
  succeeded: 2,
  failed: 2,
  results: [
    { gameId: 1, name: 'Elden Ring', ok: true, message: 'Updated to 3.7.10' },
    { gameId: 2, name: 'Cyber Nova 2077', ok: true, message: 'Updated to 3.7.10' },
    { gameId: 10, name: 'City Skyline X', ok: false, message: 'Access denied' },
    { gameId: 11, name: 'Neon Rider', ok: false, message: 'Game is running' },
  ],
}

/** Empty-library detection: no game has any detected DLL. */
const EMPTY_GAME_STATES: GameDlssState[] = DLSS_GAME_STATES.map((state) => ({
  gameId: state.gameId,
  folderResolved: state.folderResolved,
  lastScannedAt: state.lastScannedAt,
  stale: false,
}))

const NO_NVIDIA_SUPPORT: DlssSupport = { nvapiAvailable: false, isElevated: true }
const NOT_ELEVATED_SUPPORT: DlssSupport = { nvapiAvailable: true, isElevated: false }
const DEFAULT_INDICATOR_MODE: DlssIndicatorMode = 'off'

/** Error message that the elevation-error heuristic recognises. */
const ELEVATION_ERROR = 'This action requires elevation (administrator privilege).'

/**
 * Per-scenario override selector. Driven by the `dlssFixture` query param on the
 * route hash (e.g. `#/dlss?dlssFixture=no-nvidia`) so screenshots can exercise
 * each state deterministically without inline data in the mock router.
 */
type DlssScenario =
  | 'default'
  | 'no-nvidia'
  | 'not-elevated'
  | 'empty'
  | 'mid-download'
  | 'mid-apply'
  | 'batch-failures'
  | 'elevation-toast'
  | 'scanning'
  | 'loading'

function getDlssScenario(): DlssScenario {
  if (typeof window === 'undefined') {
    return 'default'
  }
  const [, search = ''] = window.location.hash.split('?')
  const value = new URLSearchParams(search).get('dlssFixture')
  switch (value) {
    case 'no-nvidia':
    case 'not-elevated':
    case 'empty':
    case 'mid-download':
    case 'mid-apply':
    case 'batch-failures':
    case 'elevation-toast':
    case 'scanning':
    case 'loading':
      return value
    default:
      return 'default'
  }
}

/** Never-resolving promise to hold a loading state for a stable screenshot. */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => {})
}

function getIndicatorStore(): { mode: DlssIndicatorMode } {
  const scope = globalThis as typeof globalThis & {
    __playwrightDlssIndicator?: { mode: DlssIndicatorMode }
  }
  if (!scope.__playwrightDlssIndicator) {
    scope.__playwrightDlssIndicator = { mode: DEFAULT_INDICATOR_MODE }
  }
  return scope.__playwrightDlssIndicator
}

export const dlssFixtures: Record<string, PlaywrightFixtureHandler> = {
  dlss_get_support: () => {
    switch (getDlssScenario()) {
      case 'no-nvidia':
        return NO_NVIDIA_SUPPORT
      case 'not-elevated':
        return NOT_ELEVATED_SUPPORT
      default:
        return DLSS_SUPPORT
    }
  },
  dlss_get_scan_status: () => {
    const status: DlssScanStatus = { scanning: getDlssScenario() === 'scanning' }
    return status
  },
  dlss_get_catalog: () => (getDlssScenario() === 'loading' ? pending<DllCatalog>() : DLSS_CATALOG),
  dlss_get_game_state: (args) =>
    DLSS_GAME_STATES.find((state) => state.gameId === args?.gameId) ?? {
      gameId: Number(args?.gameId ?? 0),
      stale: true,
    },
  dlss_list_game_states: () =>
    getDlssScenario() === 'empty' ? EMPTY_GAME_STATES : DLSS_GAME_STATES,
  dlss_scan_game: (args) =>
    DLSS_GAME_STATES.find((state) => state.gameId === args?.gameId) ?? {
      gameId: Number(args?.gameId ?? 0),
      stale: false,
    },
  dlss_scan_library: () => (getDlssScenario() === 'empty' ? EMPTY_GAME_STATES : DLSS_GAME_STATES),
  dlss_set_folder_override: (args) => ({
    gameId: Number(args?.gameId ?? 0),
    folderOverride: (args?.folder as string | null) ?? undefined,
    stale: false,
  }),
  dlss_download_version: () => {
    // Mid-download: never resolve so the trigger stays in its in-progress state
    // for the screenshot. Condition-based — Playwright waits on the trigger text,
    // not a fixed delay.
    if (getDlssScenario() === 'mid-download') {
      return new Promise<void>(() => {})
    }
    return undefined
  },
  dlss_cancel_download: () => undefined,
  dlss_apply_to_game: (args) =>
    DLSS_GAME_STATES.find((state) => state.gameId === args?.gameId) ?? {
      gameId: Number(args?.gameId ?? 0),
      stale: false,
    },
  dlss_apply_to_all: () => {
    switch (getDlssScenario()) {
      case 'mid-apply':
        return pending<BatchApplyResult>()
      case 'batch-failures':
        return BATCH_RESULT_WITH_FAILURES
      case 'elevation-toast':
        return Promise.reject(new Error(ELEVATION_ERROR))
      default:
        return BATCH_RESULT
    }
  },
  dlss_count_applicable: () => (getDlssScenario() === 'empty' ? 0 : 2),
  dlss_get_preset_options: (args) =>
    args?.presetKind === 'rayReconstruction' ? RR_PRESET_OPTIONS : SR_PRESET_OPTIONS,
  dlss_get_global_preset: () => 0,
  dlss_set_global_preset: () => undefined,
  dlss_get_global_indicator: () => getIndicatorStore().mode,
  dlss_set_global_indicator: (args) => {
    getIndicatorStore().mode =
      (args?.mode as DlssIndicatorMode | undefined) ?? DEFAULT_INDICATOR_MODE
    return undefined
  },
  dlss_get_game_preset: (args) => gamePresetState(Number(args?.gameId ?? 0)),
  dlss_set_game_preset: () => undefined,
  dlss_save_game: (args) =>
    DLSS_GAME_STATES.find((state) => state.gameId === args?.gameId) ?? {
      gameId: Number(args?.gameId ?? 0),
      stale: false,
    },
  dlss_relaunch_elevated: () => undefined,
}
