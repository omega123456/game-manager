import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type {
  ApplyResult,
  BatchApplyResult,
  DllCatalog,
  DlssIndicatorMode,
  DlssScanStatus,
  DllType,
  DlssScanProgress,
  DlssSupport,
  DownloadProgress,
  GameDlssState,
  GamePresetState,
  PresetKind,
  PresetOption,
  SaveGameDlss,
} from '@/types/dlss'

/**
 * Typed `invoke()` wrappers for the DLSS feature — the only path the frontend
 * uses to reach the backend DLSS commands. Names map the registered snake_case
 * Rust commands; argument keys are camelCase (Tauri converts them).
 */

/** DLSS event channels emitted by the backend. */
export const DLSS_EVENTS = {
  /** Streamed download progress for a single version. */
  downloadProgress: 'dlss://download-progress',
  /** Per-game progress during an "Apply to All" batch. */
  applyProgress: 'dlss://apply-progress',
  /** Emitted once the startup library scan finishes (session detection ready). */
  libraryScanned: 'dlss://library-scanned',
  /** Per-game progress during the startup library scan (pills appear gradually). */
  scanProgress: 'dlss://scan-progress',
} as const

/** NVAPI availability + elevation state. */
export function getDlssSupport(): Promise<DlssSupport> {
  return invoke<DlssSupport>('dlss_get_support')
}

/** Whether the full-library DLSS scan is currently running. */
export function getDlssScanStatus(): Promise<DlssScanStatus> {
  return invoke<DlssScanStatus>('dlss_get_scan_status')
}

/** Resolve the version catalog (cached, or refreshed from upstream). */
export function getDlssCatalog(refresh = false): Promise<DllCatalog> {
  return invoke<DllCatalog>('dlss_get_catalog', { refresh })
}

/** Cached per-game DLSS state (cheap, no NVAPI). */
export function getDlssGameState(gameId: number): Promise<GameDlssState> {
  return invoke<GameDlssState>('dlss_get_game_state', { gameId })
}

/** Cached states for the whole library (drives pills). */
export function listDlssGameStates(): Promise<GameDlssState[]> {
  return invoke<GameDlssState[]>('dlss_list_game_states')
}

/** Force a re-scan of one game. */
export function scanDlssGame(gameId: number): Promise<GameDlssState> {
  return invoke<GameDlssState>('dlss_scan_game', { gameId })
}

/** Re-scan all applicable games. */
export function scanDlssLibrary(): Promise<GameDlssState[]> {
  return invoke<GameDlssState[]>('dlss_scan_library')
}

/** Set (or clear) a game's folder override. */
export function setDlssFolderOverride(
  gameId: number,
  folder: string | null
): Promise<GameDlssState> {
  return invoke<GameDlssState>('dlss_set_folder_override', { gameId, folder })
}

/** Download a version; resolves when complete (progress via events). */
export function downloadDlssVersion(dllType: DllType, version: string): Promise<void> {
  return invoke<void>('dlss_download_version', { dllType, version })
}

/** Cancel an in-flight download. */
export function cancelDlssDownload(dllType: DllType, version: string): Promise<void> {
  return invoke<void>('dlss_cancel_download', { dllType, version })
}

/**
 * Apply a version to a single game, or restore the System Default when `version`
 * is `null`.
 */
export function applyDlssToGame(
  gameId: number,
  dllType: DllType,
  version: string | null
): Promise<GameDlssState> {
  return invoke<GameDlssState>('dlss_apply_to_game', { gameId, dllType, version })
}

/** Apply a version to every applicable game (progress via events). */
export function applyDlssToAll(dllType: DllType, version: string): Promise<BatchApplyResult> {
  return invoke<BatchApplyResult>('dlss_apply_to_all', { dllType, version })
}

/** Count games where `dllType` is currently detected. */
export function countDlssApplicable(dllType: DllType): Promise<number> {
  return invoke<number>('dlss_count_applicable', { dllType })
}

/** Bundled preset options for the given kind. */
export function getDlssPresetOptions(presetKind: PresetKind): Promise<PresetOption[]> {
  return invoke<PresetOption[]>('dlss_get_preset_options', { presetKind })
}

/** Read the global (base profile) preset value (live NVAPI). */
export function getDlssGlobalPreset(presetKind: PresetKind): Promise<number> {
  return invoke<number>('dlss_get_global_preset', { presetKind })
}

/** Write the global (base profile) preset value (live NVAPI). */
export function setDlssGlobalPreset(presetKind: PresetKind, value: number): Promise<void> {
  return invoke<void>('dlss_set_global_preset', { presetKind, value })
}

/** Read the global DLSS on-screen indicator mode. */
export function getDlssGlobalIndicator(): Promise<DlssIndicatorMode> {
  return invoke<DlssIndicatorMode>('dlss_get_global_indicator')
}

/** Write the global DLSS on-screen indicator mode. */
export function setDlssGlobalIndicator(mode: DlssIndicatorMode): Promise<void> {
  return invoke<void>('dlss_set_global_indicator', { mode })
}

/** Read the per-game preset state (live NVAPI). */
export function getDlssGamePreset(
  gameId: number,
  presetKind: PresetKind
): Promise<GamePresetState> {
  return invoke<GamePresetState>('dlss_get_game_preset', { gameId, presetKind })
}

/** Write the per-game preset value (live NVAPI). */
export function setDlssGamePreset(
  gameId: number,
  presetKind: PresetKind,
  value: number
): Promise<void> {
  return invoke<void>('dlss_set_game_preset', { gameId, presetKind, value })
}

/** Apply all per-game DLSS changes (DLLs + presets + folder) in one call. */
export function saveDlssGame(gameId: number, changes: SaveGameDlss): Promise<GameDlssState> {
  return invoke<GameDlssState>('dlss_save_game', { gameId, changes })
}

/** Relaunch the app as Administrator (never returns on success). */
export function relaunchElevated(): Promise<void> {
  return invoke<void>('dlss_relaunch_elevated')
}

/** Subscribe to download-progress events. Returns the unlisten function. */
export function onDlssDownloadProgress(
  handler: (payload: DownloadProgress) => void
): Promise<UnlistenFn> {
  return listen<DownloadProgress>(DLSS_EVENTS.downloadProgress, (e) => handler(e.payload))
}

/** Subscribe to per-game apply-progress events. Returns the unlisten function. */
export function onDlssApplyProgress(handler: (payload: ApplyResult) => void): Promise<UnlistenFn> {
  return listen<ApplyResult>(DLSS_EVENTS.applyProgress, (e) => handler(e.payload))
}

/** Subscribe to the startup library-scan-complete event. Returns the unlisten function. */
export function onDlssLibraryScanned(handler: () => void): Promise<UnlistenFn> {
  return listen<unknown>(DLSS_EVENTS.libraryScanned, () => handler())
}

/** Subscribe to per-game library-scan progress events. Returns the unlisten function. */
export function onDlssScanProgress(
  handler: (payload: DlssScanProgress) => void
): Promise<UnlistenFn> {
  return listen<DlssScanProgress>(DLSS_EVENTS.scanProgress, (e) => handler(e.payload))
}
