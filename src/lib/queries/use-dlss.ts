import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  applyDlssToAll,
  applyDlssToGame,
  countDlssApplicable,
  downloadDlssVersion,
  getDlssCatalog,
  getDlssGamePreset,
  getDlssGameState,
  getDlssGlobalPreset,
  getDlssPresetOptions,
  getDlssSupport,
  listDlssGameStates,
  onDlssApplyProgress,
  onDlssDownloadProgress,
  saveDlssGame,
  scanDlssGame,
  scanDlssLibrary,
  setDlssFolderOverride,
  setDlssGamePreset,
  setDlssGlobalPreset,
} from '@/lib/ipc/dlss-commands'
import { logFrontend } from '@/lib/app-log-commands'
import {
  DLSS_APPLICABLE_QUERY_KEY,
  DLSS_CATALOG_QUERY_KEY,
  DLSS_GAME_PRESET_QUERY_KEY,
  DLSS_GAME_STATE_QUERY_KEY,
  DLSS_GLOBAL_PRESET_QUERY_KEY,
  DLSS_PRESET_OPTIONS_QUERY_KEY,
  DLSS_STATES_QUERY_KEY,
  DLSS_SUPPORT_QUERY_KEY,
  GAMES_QUERY_KEY,
} from '@/lib/queries/query-keys'
import type {
  ApplyResult,
  BatchApplyResult,
  DllType,
  DownloadProgress,
  PresetKind,
  SaveGameDlss,
} from '@/types/dlss'

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** NVAPI availability + elevation state. */
export function useDlssSupportQuery() {
  return useQuery({
    queryKey: DLSS_SUPPORT_QUERY_KEY,
    queryFn: getDlssSupport,
  })
}

/** The version catalog (cached or refreshed). */
export function useDlssCatalogQuery() {
  return useQuery({
    queryKey: DLSS_CATALOG_QUERY_KEY,
    queryFn: () => getDlssCatalog(true),
  })
}

/** Cached states for the whole library (drives pills). */
export function useDlssGameStatesQuery() {
  return useQuery({
    queryKey: DLSS_STATES_QUERY_KEY,
    queryFn: listDlssGameStates,
  })
}

/** Cached per-game state. */
export function useDlssGameStateQuery(gameId: number | null) {
  return useQuery({
    queryKey: [...DLSS_GAME_STATE_QUERY_KEY, gameId],
    queryFn: () => getDlssGameState(gameId as number),
    enabled: gameId !== null,
  })
}

/** Bundled preset options for a kind. */
export function useDlssPresetOptionsQuery(kind: PresetKind) {
  return useQuery({
    queryKey: [...DLSS_PRESET_OPTIONS_QUERY_KEY, kind],
    queryFn: () => getDlssPresetOptions(kind),
  })
}

/** Live global preset value for a kind (NVAPI; only when support exists). */
export function useDlssGlobalPresetQuery(kind: PresetKind, enabled: boolean) {
  return useQuery({
    queryKey: [...DLSS_GLOBAL_PRESET_QUERY_KEY, kind],
    queryFn: () => getDlssGlobalPreset(kind),
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
  })
}

/** Live per-game preset state for a kind (NVAPI; only when the tab is open). */
export function useDlssGamePresetQuery(gameId: number | null, kind: PresetKind, enabled: boolean) {
  return useQuery({
    queryKey: [...DLSS_GAME_PRESET_QUERY_KEY, gameId, kind],
    queryFn: () => getDlssGamePreset(gameId as number, kind),
    enabled: enabled && gameId !== null,
    staleTime: 0,
    refetchOnMount: 'always',
  })
}

/** Count of applicable games for a DLL type. */
export function useDlssApplicableCountQuery(dllType: DllType) {
  return useQuery({
    queryKey: [...DLSS_APPLICABLE_QUERY_KEY, dllType],
    queryFn: () => countDlssApplicable(dllType),
  })
}

// ---------------------------------------------------------------------------
// Invalidation helper
// ---------------------------------------------------------------------------

/** Invalidate every cached DLSS query plus the games list (pills). */
export function useInvalidateDlss() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: DLSS_STATES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: DLSS_GAME_STATE_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: DLSS_APPLICABLE_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: DLSS_CATALOG_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY })
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Re-scan the whole library. */
export function useScanDlssLibraryMutation() {
  const invalidate = useInvalidateDlss()
  return useMutation({
    mutationFn: scanDlssLibrary,
    onSuccess: invalidate,
  })
}

/** Re-scan a single game. */
export function useScanDlssGameMutation() {
  const invalidate = useInvalidateDlss()
  return useMutation({
    mutationFn: (gameId: number) => scanDlssGame(gameId),
    onSuccess: invalidate,
  })
}

/** Download a single version (progress arrives via events). */
export function useDownloadDlssVersionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ dllType, version }: { dllType: DllType; version: string }) =>
      downloadDlssVersion(dllType, version),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DLSS_CATALOG_QUERY_KEY })
    },
  })
}

/** Apply a version (or System Default) to a single game. */
export function useApplyDlssToGameMutation() {
  const invalidate = useInvalidateDlss()
  return useMutation({
    mutationFn: ({
      gameId,
      dllType,
      version,
    }: {
      gameId: number
      dllType: DllType
      version: string | null
    }) => applyDlssToGame(gameId, dllType, version),
    onSuccess: invalidate,
  })
}

/** Apply a version to every applicable game. */
export function useApplyDlssToAllMutation() {
  const invalidate = useInvalidateDlss()
  return useMutation<BatchApplyResult, unknown, { dllType: DllType; version: string }>({
    mutationFn: ({ dllType, version }) => applyDlssToAll(dllType, version),
    onSuccess: invalidate,
  })
}

/** Set the global preset value for a kind. */
export function useSetDlssGlobalPresetMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, value }: { kind: PresetKind; value: number }) =>
      setDlssGlobalPreset(kind, value),
    onSuccess: (_data, { kind }) => {
      void queryClient.invalidateQueries({
        queryKey: [...DLSS_GLOBAL_PRESET_QUERY_KEY, kind],
      })
    },
  })
}

/** Set the per-game preset value for a kind. */
export function useSetDlssGamePresetMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ gameId, kind, value }: { gameId: number; kind: PresetKind; value: number }) =>
      setDlssGamePreset(gameId, kind, value),
    onSuccess: (_data, { gameId, kind }) => {
      void queryClient.invalidateQueries({
        queryKey: [...DLSS_GAME_PRESET_QUERY_KEY, gameId, kind],
      })
    },
  })
}

/** Set (or clear) a game's folder override. */
export function useSetDlssFolderOverrideMutation() {
  const invalidate = useInvalidateDlss()
  return useMutation({
    mutationFn: ({ gameId, folder }: { gameId: number; folder: string | null }) =>
      setDlssFolderOverride(gameId, folder),
    onSuccess: invalidate,
  })
}

/** Apply all per-game changes in one call. */
export function useSaveDlssGameMutation() {
  const invalidate = useInvalidateDlss()
  return useMutation({
    mutationFn: ({ gameId, changes }: { gameId: number; changes: SaveGameDlss }) =>
      saveDlssGame(gameId, changes),
    onSuccess: invalidate,
  })
}

// ---------------------------------------------------------------------------
// Event bridges
// ---------------------------------------------------------------------------

/** A stable key for a (type, version) download. */
export function downloadKey(dllType: DllType, version: string): string {
  return `${dllType}:${version}`
}

/**
 * Subscribe (once) to `dlss://download-progress` and expose the latest progress
 * per `(dllType, version)`. Completed/errored entries are retained so callers can
 * read the terminal state; clear via the returned `clear` callback.
 */
export function useDlssDownloadProgress(): {
  progress: Record<string, DownloadProgress>
  clear: (dllType: DllType, version: string) => void
} {
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({})

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false

    void onDlssDownloadProgress((payload) => {
      setProgress((prev) => ({ ...prev, [downloadKey(payload.dllType, payload.version)]: payload }))
    })
      .then((fn) => {
        if (cancelled) {
          fn()
          return
        }
        unlisten = fn
      })
      .catch((error: unknown) => {
        logFrontend('warn', 'Failed to subscribe to DLSS download progress.', {
          category: 'dlss.events',
          details: error instanceof Error ? error.message : String(error),
        })
      })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  const clear = (dllType: DllType, version: string): void => {
    setProgress((prev) => {
      const next = { ...prev }
      delete next[downloadKey(dllType, version)]
      return next
    })
  }

  return { progress, clear }
}

/**
 * Subscribe (once) to `dlss://apply-progress` and accumulate per-game results
 * for the in-flight batch. Returns the accumulated results and a `reset`.
 */
export function useDlssApplyProgress(): {
  results: ApplyResult[]
  reset: () => void
} {
  const [results, setResults] = useState<ApplyResult[]>([])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false

    void onDlssApplyProgress((payload) => {
      setResults((prev) => [...prev, payload])
    })
      .then((fn) => {
        if (cancelled) {
          fn()
          return
        }
        unlisten = fn
      })
      .catch((error: unknown) => {
        logFrontend('warn', 'Failed to subscribe to DLSS apply progress.', {
          category: 'dlss.events',
          details: error instanceof Error ? error.message : String(error),
        })
      })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  const reset = (): void => setResults([])

  return { results, reset }
}
