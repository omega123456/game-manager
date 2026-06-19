import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { GameDetailDlssTab } from '@/features/dlss/game-detail-dlss-tab'
import { useToastStore } from '@/stores/toast-store'
import type { DllCatalog, GameDlssState, GamePresetState, PresetOption } from '@/types/dlss'
import { renderWithProviders } from '../../helpers/render-app'
import { ipc } from '../../ipc-mock'

const STATE: GameDlssState = {
  gameId: 7,
  folderOverride: 'D:\\Games\\Cyberpunk',
  folderResolved: 'D:\\Games\\Cyberpunk',
  superResolution: { version: '3.5.10', path: 'a' },
  frameGeneration: { version: '1.1.0', path: 'b' },
  stale: false,
}

const CATALOG: DllCatalog = {
  superResolution: [
    {
      type: 'superResolution',
      version: '3.7.10',
      versionNumber: 3710,
      label: 'v3.7.10 (Latest)',
      md5: 'm',
      zipMd5: 'z',
      downloadUrl: 'u',
      fileSizeBytes: 1,
      zipSizeBytes: 1,
      isSignatureValid: true,
      isDownloaded: true,
    },
    {
      type: 'superResolution',
      version: '3.5.10',
      versionNumber: 3510,
      label: 'v3.5.10',
      md5: 'm',
      zipMd5: 'z',
      downloadUrl: 'u',
      fileSizeBytes: 1,
      zipSizeBytes: 1,
      isSignatureValid: true,
      isDownloaded: true,
    },
  ],
  frameGeneration: [],
  rayReconstruction: [],
  source: 'static',
}

const PRESET_OPTIONS: PresetOption[] = [
  { value: 0, name: 'Default', deprecated: false },
  { value: 5, name: 'Preset E', deprecated: false },
]

const AVAILABLE_PRESET: GamePresetState = { available: true, value: 0 }
const UNAVAILABLE_PRESET: GamePresetState = { available: false, value: 0 }

function seedCommon(): void {
  ipc.override('dlss_get_game_state', () => STATE)
  ipc.override('dlss_get_catalog', () => CATALOG)
  ipc.override('dlss_get_preset_options', () => PRESET_OPTIONS)
}

describe('GameDetailDlssTab', () => {
  afterEach(() => useToastStore.setState({ toasts: [] }))

  it('lists detected versions and seeds the folder override', async () => {
    seedCommon()
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: false, isElevated: true }))
    renderWithProviders(<GameDetailDlssTab gameId={7} />)

    const summary = await screen.findByTestId('game-detail-dlss')
    expect(screen.getByTestId('game-detail-dlss-footer')).toHaveAttribute(
      'data-footer-mode',
      'inline'
    )
    await waitFor(() => expect(summary).toHaveTextContent('v3.5.10'))
    expect(summary).toHaveTextContent('v1.1.0')
    expect(summary).toHaveTextContent('Not detected')
    await waitFor(() => {
      expect(screen.getByLabelText('Game folder override')).toHaveValue('D:\\Games\\Cyberpunk')
    })
  })

  it('disables Save until a value changes, then saves all changes', async () => {
    const user = userEvent.setup()
    seedCommon()
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: false, isElevated: true }))
    renderWithProviders(<GameDetailDlssTab gameId={7} />)

    const summary = await screen.findByTestId('game-detail-dlss')
    await waitFor(() => expect(summary).toHaveTextContent('v3.5.10'))
    const save = screen.getByRole('button', { name: 'Save DLSS settings for this game' })
    expect(save).toBeDisabled()

    const folderInput = screen.getByLabelText('Game folder override')
    await user.clear(folderInput)
    await user.type(folderInput, 'E:\\Moved')
    await waitFor(() => expect(save).toBeEnabled())

    await user.click(save)
    await waitFor(() => {
      expect(ipc.calls('dlss_save_game')).toEqual([
        {
          gameId: 7,
          changes: {
            folderOverride: 'E:\\Moved',
          },
        },
      ])
    })
    expect(useToastStore.getState().toasts.some((t) => t.tone === 'success')).toBe(true)
  })

  it('shows the presets-unavailable callout and disables preset controls', async () => {
    seedCommon()
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: true, isElevated: true }))
    ipc.override('dlss_get_game_preset', () => UNAVAILABLE_PRESET)
    renderWithProviders(<GameDetailDlssTab gameId={7} />)

    expect(await screen.findByText('Presets unavailable')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'DLSS Preset' })).toBeDisabled()
  })

  it('includes presets in the save payload when available', async () => {
    const user = userEvent.setup()
    seedCommon()
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: true, isElevated: true }))
    ipc.override('dlss_get_game_preset', () => AVAILABLE_PRESET)
    renderWithProviders(<GameDetailDlssTab gameId={7} />)

    const combo = await screen.findByRole('combobox', { name: 'DLSS Preset' })
    await waitFor(() => expect(combo).toBeEnabled())
    await user.click(combo)
    await user.click(await screen.findByText('Preset E'))

    const save = await screen.findByRole('button', { name: 'Save DLSS settings for this game' })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    await waitFor(() => {
      const calls = ipc.calls('dlss_save_game') as { changes: { srPreset?: number } }[]
      expect(calls[0]?.changes.srPreset).toBe(5)
    })
  })

  it('sends an explicit system-default reset when a detected DLL is cleared', async () => {
    const user = userEvent.setup()
    seedCommon()
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: false, isElevated: true }))
    renderWithProviders(<GameDetailDlssTab gameId={7} />)

    const combo = await screen.findByRole('combobox', { name: 'DLSS Super Resolution' })
    await user.click(combo)
    await user.click(await screen.findByRole('option', { name: /System Default/i }))

    const save = screen.getByRole('button', { name: 'Save DLSS settings for this game' })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    await waitFor(() => {
      const calls = ipc.calls('dlss_save_game') as {
        changes: { sr?: { mode: string } }
      }[]
      expect(calls[0]?.changes.sr).toEqual({ mode: 'systemDefault' })
    })
  })

  it('enables Save and includes the new version when a DLL selection changes', async () => {
    const user = userEvent.setup()
    seedCommon()
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: false, isElevated: true }))
    renderWithProviders(<GameDetailDlssTab gameId={7} />)

    const summary = await screen.findByTestId('game-detail-dlss')
    await waitFor(() => expect(summary).toHaveTextContent('v3.5.10'))

    const combo = screen.getByRole('combobox', { name: 'DLSS Super Resolution' })
    await user.click(combo)
    await user.click(await screen.findByText('v3.7.10 (Latest)'))

    const save = screen.getByRole('button', { name: 'Save DLSS settings for this game' })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    await waitFor(() => {
      const calls = ipc.calls('dlss_save_game') as {
        changes: { sr?: { mode: string; version: string } }
      }[]
      expect(calls[0]?.changes.sr).toEqual({ mode: 'version', version: '3.7.10' })
    })
  })

  it('disables DLL and preset controls when the matching DLL is not detected', async () => {
    seedCommon()
    ipc.override('dlss_get_game_state', () => ({
      ...STATE,
      frameGeneration: undefined,
    }))
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: true, isElevated: true }))
    ipc.override('dlss_get_game_preset', () => AVAILABLE_PRESET)
    renderWithProviders(<GameDetailDlssTab gameId={7} />)

    const summary = await screen.findByTestId('game-detail-dlss')
    await waitFor(() => expect(summary).toHaveTextContent('v3.5.10'))
    expect(await screen.findByRole('combobox', { name: 'DLSS Super Resolution' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: 'DLSS Frame Generation' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'DLSS Ray Reconstruction' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'DLSS Preset' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: 'Ray Reconstruction Preset' })).toBeDisabled()
  })

  it('updates the folder override via the folder picker', async () => {
    const user = userEvent.setup()
    seedCommon()
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: false, isElevated: true }))
    ipc.override('plugin:dialog|open', () => 'F:\\Picked\\Folder')
    renderWithProviders(<GameDetailDlssTab gameId={7} />)

    const summary = await screen.findByTestId('game-detail-dlss')
    await waitFor(() => expect(summary).toHaveTextContent('v3.5.10'))
    await user.click(screen.getByRole('button', { name: 'Browse for game folder' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Game folder override')).toHaveValue('F:\\Picked\\Folder')
    })
  })

  it('shows an error when the folder picker fails', async () => {
    const user = userEvent.setup()
    seedCommon()
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: false, isElevated: true }))
    ipc.override('plugin:dialog|open', () => {
      throw new Error('picker exploded')
    })
    renderWithProviders(<GameDetailDlssTab gameId={7} />)

    await screen.findByTestId('game-detail-dlss')
    await user.click(screen.getByRole('button', { name: 'Browse for game folder' }))

    expect(await screen.findByText('picker exploded')).toBeInTheDocument()
  })

  it('routes a privileged save failure to the elevation toast', async () => {
    const user = userEvent.setup()
    seedCommon()
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: false, isElevated: true }))
    ipc.override('dlss_save_game', () => {
      throw new Error('Access denied to protected files')
    })
    renderWithProviders(<GameDetailDlssTab gameId={7} />)

    const summary = await screen.findByTestId('game-detail-dlss')
    await waitFor(() => expect(summary).toHaveTextContent('v3.5.10'))
    const folderInput = screen.getByLabelText('Game folder override')
    await user.clear(folderInput)
    await user.type(folderInput, 'E:\\Moved')
    const save = screen.getByRole('button', { name: 'Save DLSS settings for this game' })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    await waitFor(() => {
      expect(
        useToastStore.getState().toasts.some((t) => t.title === 'Administrator access required')
      ).toBe(true)
    })
  })

  it('surfaces an error toast when saving fails', async () => {
    const user = userEvent.setup()
    seedCommon()
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: false, isElevated: true }))
    ipc.override('dlss_save_game', () => {
      throw new Error('boom')
    })
    renderWithProviders(<GameDetailDlssTab gameId={7} />)

    const folderInput = await screen.findByLabelText('Game folder override')
    await user.clear(folderInput)
    await user.type(folderInput, 'E:\\Moved')
    const save = screen.getByRole('button', { name: 'Save DLSS settings for this game' })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.tone === 'error')).toBe(true)
    })
  })
})
