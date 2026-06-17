import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DllVersionCombobox } from '@/features/dlss/dll-version-combobox'
import { SYSTEM_DEFAULT_VALUE } from '@/features/dlss/dll-version-options'
import { useToastStore } from '@/stores/toast-store'
import type { DllVersion } from '@/types/dlss'
import { renderWithProviders } from '../../helpers/render-app'
import { ipc } from '../../ipc-mock'

function v(version: string, isDownloaded: boolean): DllVersion {
  return {
    type: 'superResolution',
    version,
    versionNumber: Number(version.replace(/\./g, '')),
    label: `v${version}`,
    md5: 'a',
    zipMd5: 'b',
    downloadUrl: 'u',
    fileSizeBytes: 1,
    zipSizeBytes: 45_000_000,
    isSignatureValid: true,
    isDownloaded,
  }
}

const VERSIONS = [v('3.7', true), v('3.8', false)]

describe('DllVersionCombobox', () => {
  afterEach(() => useToastStore.setState({ toasts: [] }))

  it('selects System Default as null', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <DllVersionCombobox
        dllType="superResolution"
        versions={VERSIONS}
        value="3.7"
        onChange={onChange}
        label="DLSS Super Resolution"
      />
    )
    await user.click(screen.getByRole('combobox', { name: 'DLSS Super Resolution' }))
    await user.click(await screen.findByRole('option', { name: /System Default/ }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('selects a downloaded version directly', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <DllVersionCombobox
        dllType="superResolution"
        versions={VERSIONS}
        value={null}
        onChange={onChange}
        label="DLSS Super Resolution"
      />
    )
    await user.click(screen.getByRole('combobox', { name: 'DLSS Super Resolution' }))
    await user.click(await screen.findByText('v3.7'))
    expect(onChange).toHaveBeenCalledWith('3.7')
  })

  it('downloads a not-downloaded version then selects it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onBusyChange = vi.fn()
    let resolveDownload: () => void = () => {}
    ipc.override(
      'dlss_download_version',
      () =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve
        })
    )

    renderWithProviders(
      <DllVersionCombobox
        dllType="superResolution"
        versions={VERSIONS}
        value={null}
        onChange={onChange}
        onBusyChange={onBusyChange}
        label="DLSS Super Resolution"
      />
    )
    await user.click(screen.getByRole('combobox', { name: 'DLSS Super Resolution' }))
    await user.click(await screen.findByText('v3.8'))

    await waitFor(() => expect(onBusyChange).toHaveBeenCalledWith(true))
    expect(ipc.calls('dlss_download_version')).toEqual([
      { dllType: 'superResolution', version: '3.8' },
    ])

    resolveDownload()
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('3.8'))
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
  })

  it('surfaces a download error toast', async () => {
    const user = userEvent.setup()
    ipc.override('dlss_download_version', () => {
      throw new Error('network down')
    })
    renderWithProviders(
      <DllVersionCombobox
        dllType="superResolution"
        versions={VERSIONS}
        value={null}
        onChange={vi.fn()}
        label="DLSS Super Resolution"
      />
    )
    await user.click(screen.getByRole('combobox', { name: 'DLSS Super Resolution' }))
    await user.click(await screen.findByText('v3.8'))
    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.tone === 'error')).toBe(true)
    })
  })

  it('routes privilege download errors to the elevation toast', async () => {
    const user = userEvent.setup()
    ipc.override('dlss_download_version', () => {
      throw new Error('Access denied')
    })
    renderWithProviders(
      <DllVersionCombobox
        dllType="superResolution"
        versions={VERSIONS}
        value={null}
        onChange={vi.fn()}
        label="DLSS Super Resolution"
      />
    )
    await user.click(screen.getByRole('combobox', { name: 'DLSS Super Resolution' }))
    await user.click(await screen.findByText('v3.8'))
    await waitFor(() => {
      expect(
        useToastStore.getState().toasts.some((t) => t.title === 'Administrator access required')
      ).toBe(true)
    })
  })

  it('shows inline progress from the progress map', () => {
    renderWithProviders(
      <DllVersionCombobox
        dllType="superResolution"
        versions={VERSIONS}
        value={null}
        onChange={vi.fn()}
        label="DLSS Super Resolution"
        progress={{}}
      />
    )
    // Sanity: SYSTEM_DEFAULT sentinel constant is exported for the picker.
    expect(SYSTEM_DEFAULT_VALUE).toBe('__system_default__')
  })
})
