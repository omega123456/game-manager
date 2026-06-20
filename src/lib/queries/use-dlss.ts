import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  applyDlssToAll,
  applyDlssToGame,
  countDlssApplicable,
  downloadDlssVersion,
  getDlssCatalog,
  getDlssGlobalIndicator,
  getDlssGamePreset,
  getDlssScanStatus,
  getDlssGameState,
  getDlssGlobalPreset,
  getDlssPresetOptions,
  getDlssSupport,
  listDlssGameStates,
  onDlssApplyProgress,
  onDlssDownloadProgress,
  onDlssLibraryScanned,
  onDlssScanProgress,
  saveDlssGame,
  scanDlssGame,
  scanDlssLibrary,
  setDlssFolderOverride,
  setDlssGlobalIndicator,
  setDlssGamePreset,
  setDlssGlobalPreset,
} from '@/lib/ipc/dlss-commands'
import { logFrontend } from '@/lib/app-log-commands'
import {
  DLSS_APPLICABLE_QUERY_KEY,
  DLSS_CATALOG_QUERY_KEY,
  DLSS_GAME_PRESET_QUERY_KEY,
  DLSS_GAME_STATE_QUERY_KEY,
  DLSS_GLOBAL_INDICATOR_QUERY_KEY,
  DLSS_GLOBAL_PRESET_QUERY_KEY,
  DLSS_PRESET_OPTIONS_QUERY_KEY,
  DLSS_SCAN_STATUS_QUERY_KEY,
  DLSS_STATES_QUERY_KEY,
  DLSS_SUPPORT_QUERY_KEY,
  GAMES_QUERY_KEY,
} from '@/lib/queries/query-keys'
import { useToastStore } from '@/stores/toast-store'
import type {
  ApplyResult,
  BatchApplyResult,
  DlssIndicatorMode,
  DllType,
  DlssScanProgress,
  DownloadProgress,
  GameDlssState,
  PresetKind,
  SaveGameDlss,
} from '@/types/dlss'

declare global {
  interface Window {
    /**
     * Deterministic test hook (only installed under `VITE_PLAYWRIGHT`): drives a
     * single library-scan-progress payload so E2E can screenshot the toast.
     */
    __gmDlssScan__?: (payload: DlssScanProgress) => void
  }
}

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

/** Whether the full-library DLSS scan is currently running. */
export function useDlssScanStatusQuery() {
  return useQuery({
    queryKey: DLSS_SCAN_STATUS_QUERY_KEY,
    queryFn: getDlssScanStatus,
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
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })
}

/** Live global DLSS indicator mode. */
export function useDlssGlobalIndicatorQuery() {
  return useQuery({
    queryKey: DLSS_GLOBAL_INDICATOR_QUERY_KEY,
    queryFn: getDlssGlobalIndicator,
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
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
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

/** Upsert a single game's freshly scanned state into the cached states list. */
function upsertGameState(prev: GameDlssState[] | undefined, next: GameDlssState): GameDlssState[] {
  const list = prev ? prev.slice() : []
  const index = list.findIndex((state) => state.gameId === next.gameId)
  if (index >= 0) {
    list[index] = next
  } else {
    list.push(next)
  }
  return list
}

/**
 * Subscribe (once) to the backend's startup library-scan events.
 *
 * Two channels drive the library DLSS pills:
 * - `dlss://scan-progress` fires once per game as it is scanned. Each event
 *   upserts that game's state directly into the cached states list (so pills
 *   appear gradually, not all at once) and drives a non-blocking progress toast
 *   showing `scanned/total`.
 * - `dlss://library-scanned` fires once the scan finishes; it dismisses the
 *   toast and invalidates the DLSS + games queries so the cache reconciles with
 *   the authoritative backend snapshot (no restart needed).
 */
export function useDlssLibraryScanSync(): void {
  const queryClient = useQueryClient()
  const pushToast = useToastStore((state) => state.push)
  const updateToast = useToastStore((state) => state.update)
  const dismissToast = useToastStore((state) => state.dismiss)

  useEffect(() => {
    const unlisteners: Array<() => void> = []
    let cancelled = false
    // Id of the active scan-progress toast, or null when none is showing.
    let toastId: number | null = null

    const register = (pending: Promise<() => void>): void => {
      pending
        .then((fn) => {
          if (cancelled) {
            fn()
            return
          }
          unlisteners.push(fn)
        })
        .catch((error: unknown) => {
          logFrontend('warn', 'Failed to subscribe to DLSS library-scan events.', {
            category: 'dlss.events',
            details: error instanceof Error ? error.message : String(error),
          })
        })
    }

    const handleScanProgress = ({ scanned, total, state }: DlssScanProgress): void => {
      // Render this game's pills immediately by patching the cached list.
      queryClient.setQueryData<GameDlssState[]>(DLSS_STATES_QUERY_KEY, (prev) =>
        upsertGameState(prev, state)
      )
      // Surface / advance the non-blocking progress toast.
      if (toastId === null) {
        toastId = pushToast({
          tone: 'info',
          title: 'Scanning DLSS…',
          description: 'Detecting installed DLSS versions across your library.',
          persistent: true,
          progress: { current: scanned, total },
        })
      } else {
        updateToast(toastId, { progress: { current: scanned, total } })
      }
    }

    register(onDlssScanProgress(handleScanProgress))

    // Deterministic E2E driver — only under the Playwright web build.
    if (import.meta.env.VITE_PLAYWRIGHT === 'true') {
      window.__gmDlssScan__ = handleScanProgress
    }

    register(
      onDlssLibraryScanned(() => {
        if (toastId !== null) {
          dismissToast(toastId)
          toastId = null
        }
        void queryClient.invalidateQueries({ queryKey: DLSS_SCAN_STATUS_QUERY_KEY })
        void queryClient.invalidateQueries({ queryKey: DLSS_STATES_QUERY_KEY })
        void queryClient.invalidateQueries({ queryKey: DLSS_GAME_STATE_QUERY_KEY })
        void queryClient.invalidateQueries({ queryKey: DLSS_APPLICABLE_QUERY_KEY })
        void queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY })
      })
    )

    return () => {
      cancelled = true
      if (toastId !== null) {
        dismissToast(toastId)
        toastId = null
      }
      for (const unlisten of unlisteners) {
        unlisten()
      }
      if (import.meta.env.VITE_PLAYWRIGHT === 'true') {
        delete window.__gmDlssScan__
      }
    }
  }, [queryClient, pushToast, updateToast, dismissToast])
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

/** Set the global DLSS indicator mode. */
export function useSetDlssGlobalIndicatorMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (mode: DlssIndicatorMode) => setDlssGlobalIndicator(mode),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: DLSS_GLOBAL_INDICATOR_QUERY_KEY,
      })
    },
  })
}

/** Set the per-game preset value for a kind. */
export function useSetDlssGamePresetMutation() {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateDlss()
  return useMutation({
    mutationFn: ({ gameId, kind, value }: { gameId: number; kind: PresetKind; value: number }) =>
      setDlssGamePreset(gameId, kind, value),
    onSuccess: (_data, { gameId, kind }) => {
      void queryClient.invalidateQueries({
        queryKey: [...DLSS_GAME_PRESET_QUERY_KEY, gameId, kind],
      })
      // A preset change can alter the cached SR preset behind the library pills,
      // so refresh the detection states / games like a DLL change does.
      invalidate()
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
