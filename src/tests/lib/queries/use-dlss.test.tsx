import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'

import { createQueryClient } from '@/lib/query-client'
import {
  downloadKey,
  useApplyDlssToAllMutation,
  useApplyDlssToGameMutation,
  useDlssApplicableCountQuery,
  useDlssApplyProgress,
  useDlssCatalogQuery,
  useDlssDownloadProgress,
  useDlssGamePresetQuery,
  useDlssGameStateQuery,
  useDlssGlobalPresetQuery,
  useDlssPresetOptionsQuery,
  useDlssSupportQuery,
  useDownloadDlssVersionMutation,
  useSaveDlssGameMutation,
  useScanDlssGameMutation,
  useScanDlssLibraryMutation,
  useSetDlssFolderOverrideMutation,
  useSetDlssGamePresetMutation,
  useSetDlssGlobalPresetMutation,
} from '@/lib/queries/use-dlss'
import { DLSS_EVENTS } from '@/lib/ipc/dlss-commands'
import type { DllCatalog } from '@/types/dlss'

import { ipc } from '../../ipc-mock'

function wrapper({ children }: { children: ReactNode }) {
  const client = createQueryClient()
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('use-dlss queries', () => {
  it('loads the catalog', async () => {
    const catalog: DllCatalog = {
      superResolution: [],
      frameGeneration: [],
      rayReconstruction: [],
      source: 'cache',
    }
    ipc.override('dlss_get_catalog', () => catalog)
    const { result } = renderHook(() => useDlssCatalogQuery(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.source).toBe('cache')
  })

  it('does not run the game-state query when gameId is null', () => {
    const { result } = renderHook(() => useDlssGameStateQuery(null), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('gates the per-game preset query on enabled', () => {
    const { result } = renderHook(() => useDlssGamePresetQuery(1, 'dlss', false), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('loads support, preset options, the gated global preset, and applicable count', async () => {
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: true, isElevated: false }))
    ipc.override('dlss_get_preset_options', () => [
      { value: 0, name: 'Default', deprecated: false },
    ])
    ipc.override('dlss_get_global_preset', () => 5)
    ipc.override('dlss_count_applicable', () => 3)

    const support = renderHook(() => useDlssSupportQuery(), { wrapper })
    const options = renderHook(() => useDlssPresetOptionsQuery('dlss'), { wrapper })
    const preset = renderHook(() => useDlssGlobalPresetQuery('dlss', true), { wrapper })
    const count = renderHook(() => useDlssApplicableCountQuery('superResolution'), { wrapper })

    await waitFor(() => expect(support.result.current.data?.isElevated).toBe(false))
    await waitFor(() => expect(options.result.current.data).toHaveLength(1))
    await waitFor(() => expect(preset.result.current.data).toBe(5))
    await waitFor(() => expect(count.result.current.data).toBe(3))
  })

  it('does not run the gated global preset query when disabled', () => {
    const { result } = renderHook(() => useDlssGlobalPresetQuery('dlss', false), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('use-dlss mutations', () => {
  it('scans the library', async () => {
    ipc.override('dlss_scan_library', () => [])
    const { result } = renderHook(() => useScanDlssLibraryMutation(), { wrapper })
    await result.current.mutateAsync()
    expect(ipc.calls('dlss_scan_library')).toHaveLength(1)
  })

  it('applies to all', async () => {
    ipc.override('dlss_apply_to_all', () => ({ total: 0, succeeded: 0, failed: 0, results: [] }))
    const { result } = renderHook(() => useApplyDlssToAllMutation(), { wrapper })
    await result.current.mutateAsync({ dllType: 'superResolution', version: '3.7' })
    expect(ipc.calls('dlss_apply_to_all')).toEqual([{ dllType: 'superResolution', version: '3.7' }])
  })

  it('sets the global preset', async () => {
    const { result } = renderHook(() => useSetDlssGlobalPresetMutation(), { wrapper })
    await result.current.mutateAsync({ kind: 'dlss', value: 5 })
    expect(ipc.calls('dlss_set_global_preset')).toEqual([{ presetKind: 'dlss', value: 5 }])
  })

  it('scans a game', async () => {
    ipc.override('dlss_scan_game', () => ({ gameId: 1, stale: false }))
    const { result } = renderHook(() => useScanDlssGameMutation(), { wrapper })
    await result.current.mutateAsync(1)
    expect(ipc.calls('dlss_scan_game')).toEqual([{ gameId: 1 }])
  })

  it('downloads a version', async () => {
    const { result } = renderHook(() => useDownloadDlssVersionMutation(), { wrapper })
    await result.current.mutateAsync({ dllType: 'superResolution', version: '3.8' })
    expect(ipc.calls('dlss_download_version')).toEqual([
      { dllType: 'superResolution', version: '3.8' },
    ])
  })

  it('applies to a single game', async () => {
    ipc.override('dlss_apply_to_game', () => ({ gameId: 1, stale: false }))
    const { result } = renderHook(() => useApplyDlssToGameMutation(), { wrapper })
    await result.current.mutateAsync({ gameId: 1, dllType: 'superResolution', version: null })
    expect(ipc.calls('dlss_apply_to_game')).toEqual([
      { gameId: 1, dllType: 'superResolution', version: null },
    ])
  })

  it('sets a per-game preset', async () => {
    const { result } = renderHook(() => useSetDlssGamePresetMutation(), { wrapper })
    await result.current.mutateAsync({ gameId: 1, kind: 'rayReconstruction', value: 4 })
    expect(ipc.calls('dlss_set_game_preset')).toEqual([
      { gameId: 1, presetKind: 'rayReconstruction', value: 4 },
    ])
  })

  it('sets a folder override', async () => {
    ipc.override('dlss_set_folder_override', () => ({ gameId: 1, stale: false }))
    const { result } = renderHook(() => useSetDlssFolderOverrideMutation(), { wrapper })
    await result.current.mutateAsync({ gameId: 1, folder: 'D:/Games' })
    expect(ipc.calls('dlss_set_folder_override')).toEqual([{ gameId: 1, folder: 'D:/Games' }])
  })

  it('saves a game change-set', async () => {
    ipc.override('dlss_save_game', () => ({ gameId: 1, stale: false }))
    const { result } = renderHook(() => useSaveDlssGameMutation(), { wrapper })
    await result.current.mutateAsync({
      gameId: 1,
      changes: { sr: { mode: 'version', version: '3.7' } },
    })
    expect(ipc.calls('dlss_save_game')).toEqual([
      { gameId: 1, changes: { sr: { mode: 'version', version: '3.7' } } },
    ])
  })
})

describe('downloadKey', () => {
  it('builds a stable key', () => {
    expect(downloadKey('superResolution', '3.8')).toBe('superResolution:3.8')
  })
})

describe('useDlssDownloadProgress', () => {
  it('accumulates and clears progress per key', async () => {
    const { result } = renderHook(() => useDlssDownloadProgress(), { wrapper })
    await waitFor(() => expect(typeof result.current.clear).toBe('function'))

    await ipc.emit(DLSS_EVENTS.downloadProgress, {
      dllType: 'superResolution',
      version: '3.8',
      downloadedBytes: 5,
      totalBytes: 10,
      done: false,
    })
    await waitFor(() =>
      expect(result.current.progress['superResolution:3.8']?.downloadedBytes).toBe(5)
    )

    act(() => result.current.clear('superResolution', '3.8'))
    await waitFor(() => expect(result.current.progress['superResolution:3.8']).toBeUndefined())
  })
})

describe('useDlssApplyProgress', () => {
  it('accumulates results and resets', async () => {
    const { result } = renderHook(() => useDlssApplyProgress(), { wrapper })
    await waitFor(() => expect(typeof result.current.reset).toBe('function'))

    await ipc.emit(DLSS_EVENTS.applyProgress, { gameId: 1, name: 'Elden Ring', ok: true })
    await waitFor(() => expect(result.current.results).toHaveLength(1))

    act(() => result.current.reset())
    await waitFor(() => expect(result.current.results).toHaveLength(0))
  })
})
