import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DlssManagementPage } from '@/features/dlss/dlss-management-page'
import type { DllCatalog, DllVersion, GameDlssState } from '@/types/dlss'
import { renderWithProviders } from '../../helpers/render-app'
import { ipc } from '../../ipc-mock'

function v(version: string): DllVersion {
  return {
    type: 'superResolution',
    version,
    versionNumber: 1,
    label: `v${version}`,
    md5: 'a',
    zipMd5: 'b',
    downloadUrl: 'u',
    fileSizeBytes: 1,
    zipSizeBytes: 1,
    isSignatureValid: true,
    isDownloaded: true,
  }
}

const CATALOG: DllCatalog = {
  superResolution: [v('3.7')],
  frameGeneration: [],
  rayReconstruction: [],
  source: 'static',
}

const POPULATED: GameDlssState[] = [
  {
    gameId: 1,
    superResolution: { version: '3.7', path: 'p' },
    stale: false,
  },
]

describe('DlssManagementPage', () => {
  it('renders the header and both cards when populated', async () => {
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: true, isElevated: true }))
    ipc.override('dlss_get_catalog', () => CATALOG)
    ipc.override('dlss_list_game_states', () => POPULATED)
    ipc.override('dlss_get_global_indicator', () => 'off')
    renderWithProviders(<DlssManagementPage />, { route: '/dlss' })

    expect(
      await screen.findByRole('heading', { name: 'DLSS Management', level: 1 })
    ).toBeInTheDocument()
    expect(await screen.findByText('Global Overrides')).toBeInTheDocument()
    expect(await screen.findByText('Global Presets')).toBeInTheDocument()
    expect(await screen.findByText('Global Indicator')).toBeInTheDocument()
  })

  it('triggers a scan-if-stale on mount', async () => {
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: true, isElevated: true }))
    ipc.override('dlss_get_catalog', () => CATALOG)
    ipc.override('dlss_list_game_states', () => [{ gameId: 1, stale: true }])
    ipc.override('dlss_scan_library', () => POPULATED)
    renderWithProviders(<DlssManagementPage />, { route: '/dlss' })

    await waitFor(() => expect(ipc.calls('dlss_scan_library')).toHaveLength(1))
  })

  it('shows the empty state when no games have DLSS', async () => {
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: true, isElevated: true }))
    ipc.override('dlss_get_catalog', () => CATALOG)
    ipc.override('dlss_list_game_states', () => [])
    ipc.override('dlss_scan_library', () => [])
    renderWithProviders(<DlssManagementPage />, { route: '/dlss' })

    expect(await screen.findByText('No DLSS-compatible games detected')).toBeInTheDocument()
  })

  it('shows the elevation banner when not elevated', async () => {
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: true, isElevated: false }))
    ipc.override('dlss_get_catalog', () => CATALOG)
    ipc.override('dlss_list_game_states', () => POPULATED)
    renderWithProviders(<DlssManagementPage />, { route: '/dlss' })

    expect(await screen.findByText('Administrator access recommended')).toBeInTheDocument()
  })

  it('shows the unsupported presets callout when NVAPI is missing', async () => {
    ipc.override('dlss_get_support', () => ({ nvapiAvailable: false, isElevated: true }))
    ipc.override('dlss_get_catalog', () => CATALOG)
    ipc.override('dlss_list_game_states', () => POPULATED)
    renderWithProviders(<DlssManagementPage />, { route: '/dlss' })

    expect(await screen.findByText('Requires an NVIDIA GPU')).toBeInTheDocument()
  })
})
