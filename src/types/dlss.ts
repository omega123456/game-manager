/**
 * Shared DLSS DTOs — mirror the Rust `domain` structs (camelCase over IPC).
 *
 * These shapes are authoritative for the frontend; keep them in lock-step with
 * `src-tauri/src/domain/mod.rs`. Presets are NOT part of `GameDlssState` (they
 * require live NVAPI and are fetched separately), so rendering pills / the
 * library never triggers native calls.
 */

/** One of the three managed NVIDIA NGX DLL types. */
export type DllType = 'superResolution' | 'frameGeneration' | 'rayReconstruction'

/** A preset selector kind. Frame Generation has no exposed preset (by design). */
export type PresetKind = 'dlss' | 'rayReconstruction'

/** Global NVIDIA DLSS indicator mode. */
export type DlssIndicatorMode = 'off' | 'debugDllsOnly' | 'allDlssDlls'

/** The provenance of a returned catalog. */
export type CatalogSource = 'remote' | 'cache' | 'static'

/** A single available DLL version from the catalog. */
export interface DllVersion {
  /** Which DLL type this version belongs to. */
  type: DllType
  /** Display version (trailing `.0` trimmed, e.g. `3.7`). */
  version: string
  /** Sortable numeric version (newest = largest). */
  versionNumber: number
  /** Display label, e.g. `v3.7.10 (Latest)`. */
  label: string
  /** MD5 of the extracted DLL (used for detection matching). */
  md5: string
  /** MD5 of the downloadable zip (verified after download). */
  zipMd5: string
  /** Download URL for the version's zip. */
  downloadUrl: string
  /** Uncompressed DLL size in bytes. */
  fileSizeBytes: number
  /** Zip download size in bytes. */
  zipSizeBytes: number
  /** Whether the upstream marked the signature valid. */
  isSignatureValid: boolean
  /** Whether the DLL is present in local storage. */
  isDownloaded: boolean
}

/** The full per-type version catalog. */
export interface DllCatalog {
  superResolution: DllVersion[]
  frameGeneration: DllVersion[]
  rayReconstruction: DllVersion[]
  source: CatalogSource
  fetchedAt?: string
}

/** A single detected DLL within a game's folder. */
export interface DetectedDll {
  version: string
  path: string
  md5?: string
}

/** Per-game detection state — cached, cheap, and free of any NVAPI work. */
export interface GameDlssState {
  gameId: number
  folderOverride?: string
  folderResolved?: string
  superResolution?: DetectedDll
  frameGeneration?: DetectedDll
  rayReconstruction?: DetectedDll
  lastScannedAt?: string
  /**
   * Per-game DLSS Super Resolution preset value (NVAPI), read during the scan.
   * `undefined` when unavailable; `0` is Default. Drives the pill preset letter.
   */
  srPreset?: number
  /** Whether the cached state is stale and should be re-scanned. */
  stale: boolean
}

/** Live per-game preset state for one kind (fetched only when the tab is open). */
export interface GamePresetState {
  /** Whether a matching driver profile exists for this game. */
  available: boolean
  /** The current preset value on that profile (0 = Default when unavailable). */
  value: number
}

/** A selectable preset option from the bundled preset lists. */
export interface PresetOption {
  value: number
  name: string
  deprecated: boolean
}

/** The outcome of applying a swap to a single game. */
export interface ApplyResult {
  gameId: number
  name: string
  ok: boolean
  message?: string
}

/** The aggregate result of an "Apply to All" batch. */
export interface BatchApplyResult {
  total: number
  succeeded: number
  failed: number
  results: ApplyResult[]
}

/** Platform capability flags for the DLSS feature. */
export interface DlssSupport {
  nvapiAvailable: boolean
  isElevated: boolean
}

/** Download-progress event payload (`dlss://download-progress`). */
export interface DownloadProgress {
  dllType: DllType
  version: string
  downloadedBytes: number
  totalBytes: number
  done: boolean
  error?: string
}

export type SaveGameDllSelection = { mode: 'version'; version: string } | { mode: 'systemDefault' }

/** Per-game change-set applied in a single `dlss_save_game` call. */
export interface SaveGameDlss {
  sr?: SaveGameDllSelection
  fg?: SaveGameDllSelection
  rr?: SaveGameDllSelection
  srPreset?: number
  rrPreset?: number
  folderOverride?: string
}

/** Stable list of DLL types in display order (SR, FG, RR). */
export const DLL_TYPES: DllType[] = ['superResolution', 'frameGeneration', 'rayReconstruction']

/** Human label for each DLL type. */
export const DLL_TYPE_LABELS: Record<DllType, string> = {
  superResolution: 'DLSS Super Resolution',
  frameGeneration: 'DLSS Frame Generation',
  rayReconstruction: 'DLSS Ray Reconstruction',
}

/** Short abbreviation for each DLL type (used by card pills). */
export const DLL_TYPE_ABBR: Record<DllType, string> = {
  superResolution: 'SR',
  frameGeneration: 'FG',
  rayReconstruction: 'RR',
}
