import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyDlssToAll,
  applyDlssToGame,
  cancelDlssDownload,
  countDlssApplicable,
  DLSS_EVENTS,
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
  relaunchElevated,
  saveDlssGame,
  scanDlssGame,
  scanDlssLibrary,
  setDlssFolderOverride,
  setDlssGamePreset,
  setDlssGlobalPreset,
} from '@/lib/ipc/dlss-commands'
import type { ApplyResult, DownloadProgress } from '@/types/dlss'

import { ipc } from '../../ipc-mock'

describe('dlss-commands', () => {
  it('exposes the event channel names', () => {
    expect(DLSS_EVENTS).toEqual({
      downloadProgress: 'dlss://download-progress',
      applyProgress: 'dlss://apply-progress',
    })
  })

  it('reads support', async () => {
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: true, isElevated: false }))
    await expect(getDlssSupport()).resolves.toEqual({ nvapiAvailable: true, isElevated: false })
  })

  it('reads catalog forwarding refresh', async () => {
    await getDlssCatalog(true)
    expect(ipc.calls('dlss_get_catalog')).toEqual([{ refresh: true }])
  })

  it('defaults refresh to false', async () => {
    await getDlssCatalog()
    expect(ipc.calls('dlss_get_catalog')).toEqual([{ refresh: false }])
  })

  it('reads game state forwarding gameId', async () => {
    await getDlssGameState(7)
    expect(ipc.calls('dlss_get_game_state')).toEqual([{ gameId: 7 }])
  })

  it('lists states', async () => {
    await listDlssGameStates()
    expect(ipc.calls('dlss_list_game_states')).toEqual([{}])
  })

  it('scans a game and the library', async () => {
    await scanDlssGame(3)
    await scanDlssLibrary()
    expect(ipc.calls('dlss_scan_game')).toEqual([{ gameId: 3 }])
    expect(ipc.calls('dlss_scan_library')).toEqual([{}])
  })

  it('sets folder override with null', async () => {
    await setDlssFolderOverride(2, null)
    expect(ipc.calls('dlss_set_folder_override')).toEqual([{ gameId: 2, folder: null }])
  })

  it('downloads and cancels with type + version', async () => {
    await downloadDlssVersion('superResolution', '3.7.10')
    await cancelDlssDownload('frameGeneration', '1.1.0')
    expect(ipc.calls('dlss_download_version')).toEqual([
      { dllType: 'superResolution', version: '3.7.10' },
    ])
    expect(ipc.calls('dlss_cancel_download')).toEqual([
      { dllType: 'frameGeneration', version: '1.1.0' },
    ])
  })

  it('applies to a game with a version and with system default', async () => {
    await applyDlssToGame(1, 'superResolution', '3.7.10')
    await applyDlssToGame(1, 'rayReconstruction', null)
    expect(ipc.calls('dlss_apply_to_game')).toEqual([
      { gameId: 1, dllType: 'superResolution', version: '3.7.10' },
      { gameId: 1, dllType: 'rayReconstruction', version: null },
    ])
  })

  it('applies to all and counts applicable', async () => {
    await applyDlssToAll('superResolution', '3.7.10')
    await countDlssApplicable('frameGeneration')
    expect(ipc.calls('dlss_apply_to_all')).toEqual([
      { dllType: 'superResolution', version: '3.7.10' },
    ])
    expect(ipc.calls('dlss_count_applicable')).toEqual([{ dllType: 'frameGeneration' }])
  })

  it('reads preset options and global/game presets', async () => {
    await getDlssPresetOptions('dlss')
    await getDlssGlobalPreset('rayReconstruction')
    await getDlssGamePreset(4, 'dlss')
    expect(ipc.calls('dlss_get_preset_options')).toEqual([{ presetKind: 'dlss' }])
    expect(ipc.calls('dlss_get_global_preset')).toEqual([{ presetKind: 'rayReconstruction' }])
    expect(ipc.calls('dlss_get_game_preset')).toEqual([{ gameId: 4, presetKind: 'dlss' }])
  })

  it('writes global and game presets', async () => {
    await setDlssGlobalPreset('dlss', 5)
    await setDlssGamePreset(4, 'rayReconstruction', 1)
    expect(ipc.calls('dlss_set_global_preset')).toEqual([{ presetKind: 'dlss', value: 5 }])
    expect(ipc.calls('dlss_set_game_preset')).toEqual([
      { gameId: 4, presetKind: 'rayReconstruction', value: 1 },
    ])
  })

  it('saves a game change-set', async () => {
    await saveDlssGame(9, { sr: { mode: 'version', version: '3.7.10' }, srPreset: 5 })
    expect(ipc.calls('dlss_save_game')).toEqual([
      { gameId: 9, changes: { sr: { mode: 'version', version: '3.7.10' }, srPreset: 5 } },
    ])
  })

  it('relaunches elevated', async () => {
    await relaunchElevated()
    expect(ipc.calls('dlss_relaunch_elevated')).toEqual([{}])
  })

  describe('event subscriptions', () => {
    const unlisteners: Array<() => void> = []
    afterEach(() => {
      unlisteners.splice(0).forEach((fn) => fn())
    })

    it('delivers download progress payloads', async () => {
      const handler = vi.fn<(p: DownloadProgress) => void>()
      unlisteners.push(await onDlssDownloadProgress(handler))
      const payload: DownloadProgress = {
        dllType: 'superResolution',
        version: '3.8.0',
        downloadedBytes: 5,
        totalBytes: 10,
        done: false,
      }
      await ipc.emit(DLSS_EVENTS.downloadProgress, payload)
      expect(handler).toHaveBeenCalledWith(payload)
    })

    it('delivers apply progress payloads', async () => {
      const handler = vi.fn<(p: ApplyResult) => void>()
      unlisteners.push(await onDlssApplyProgress(handler))
      const payload: ApplyResult = { gameId: 1, name: 'Elden Ring', ok: true }
      await ipc.emit(DLSS_EVENTS.applyProgress, payload)
      expect(handler).toHaveBeenCalledWith(payload)
    })
  })
})
