import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { GlobalOverridesCard } from '@/features/dlss/global-overrides-card'
import { useToastStore } from '@/stores/toast-store'
import type { DllCatalog, DllVersion } from '@/types/dlss'
import { renderWithProviders } from '../../helpers/render-app'
import { ipc } from '../../ipc-mock'

function v(type: DllVersion['type'], version: string, isDownloaded: boolean): DllVersion {
  return {
    type,
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

const CATALOG: DllCatalog = {
  superResolution: [v('superResolution', '3.7', true)],
  frameGeneration: [v('frameGeneration', '1.1', true)],
  rayReconstruction: [v('rayReconstruction', '3.5', true)],
  source: 'static',
}

describe('GlobalOverridesCard', () => {
  afterEach(() => useToastStore.setState({ toasts: [] }))

  it('disables Apply to All until a version is selected', async () => {
    ipc.override('dlss_count_applicable', () => 12)
    renderWithProviders(<GlobalOverridesCard catalog={CATALOG} />)
    const buttons = await screen.findAllByRole('button', { name: /Apply to All/i })
    expect(buttons[0]).toBeDisabled()
  })

  it('confirms and runs an apply-to-all with a persistent result toast', async () => {
    const user = userEvent.setup()
    ipc.override('dlss_count_applicable', () => 2)
    ipc.override('dlss_apply_to_all', () => ({
      total: 2,
      succeeded: 2,
      failed: 0,
      results: [
        { gameId: 1, name: 'Elden Ring', ok: true },
        { gameId: 2, name: 'Cyber Nova', ok: true },
      ],
    }))
    renderWithProviders(<GlobalOverridesCard catalog={CATALOG} />)

    // Select a downloaded SR version.
    const srLabel = await screen.findByText('DLSS Super Resolution')
    const row = srLabel.parentElement as HTMLElement
    await user.click(within(row).getByRole('combobox', { name: 'DLSS Super Resolution' }))
    await user.click(await screen.findByText('v3.7'))

    const applyButtons = await screen.findAllByRole('button', { name: 'Apply to All (2)' })
    await waitFor(() => expect(applyButtons[0]).toBeEnabled())
    await user.click(applyButtons[0])

    await user.click(await screen.findByRole('button', { name: 'Apply to 2' }))

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts
      expect(toasts.some((t) => t.persistent && t.action?.label === 'View details')).toBe(true)
    })
  })

  it('surfaces an error toast when the batch fails', async () => {
    const user = userEvent.setup()
    ipc.override('dlss_count_applicable', () => 2)
    ipc.override('dlss_apply_to_all', () => {
      throw new Error('network down')
    })
    renderWithProviders(<GlobalOverridesCard catalog={CATALOG} />)

    const srLabel = await screen.findByText('DLSS Super Resolution')
    const row = srLabel.parentElement as HTMLElement
    await user.click(within(row).getByRole('combobox', { name: 'DLSS Super Resolution' }))
    await user.click(await screen.findByText('v3.7'))
    const applyButtons = await screen.findAllByRole('button', { name: 'Apply to All (2)' })
    await waitFor(() => expect(applyButtons[0]).toBeEnabled())
    await user.click(applyButtons[0])
    await user.click(await screen.findByRole('button', { name: 'Apply to 2' }))

    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.tone === 'error')).toBe(true)
    })
  })

  it('routes a privilege batch failure to the elevation toast', async () => {
    const user = userEvent.setup()
    ipc.override('dlss_count_applicable', () => 2)
    ipc.override('dlss_apply_to_all', () => {
      throw new Error('Access denied')
    })
    renderWithProviders(<GlobalOverridesCard catalog={CATALOG} />)

    const srLabel = await screen.findByText('DLSS Super Resolution')
    const row = srLabel.parentElement as HTMLElement
    await user.click(within(row).getByRole('combobox', { name: 'DLSS Super Resolution' }))
    await user.click(await screen.findByText('v3.7'))
    const applyButtons = await screen.findAllByRole('button', { name: 'Apply to All (2)' })
    await waitFor(() => expect(applyButtons[0]).toBeEnabled())
    await user.click(applyButtons[0])
    await user.click(await screen.findByRole('button', { name: 'Apply to 2' }))

    await waitFor(() => {
      expect(
        useToastStore.getState().toasts.some((t) => t.title === 'Administrator access required')
      ).toBe(true)
    })
  })

  it('shows the elevation toast when every batch result is a privilege failure', async () => {
    const user = userEvent.setup()
    ipc.override('dlss_count_applicable', () => 2)
    ipc.override('dlss_apply_to_all', () => ({
      total: 2,
      succeeded: 0,
      failed: 2,
      results: [
        { gameId: 1, name: 'Elden Ring', ok: false, message: 'Access denied to game folder' },
        { gameId: 2, name: 'Cyber Nova', ok: false, message: 'Administrator privilege required' },
      ],
    }))
    renderWithProviders(<GlobalOverridesCard catalog={CATALOG} />)

    const srLabel = await screen.findByText('DLSS Super Resolution')
    const row = srLabel.parentElement as HTMLElement
    await user.click(within(row).getByRole('combobox', { name: 'DLSS Super Resolution' }))
    await user.click(await screen.findByText('v3.7'))
    const applyButtons = await screen.findAllByRole('button', { name: 'Apply to All (2)' })
    await waitFor(() => expect(applyButtons[0]).toBeEnabled())
    await user.click(applyButtons[0])
    await user.click(await screen.findByRole('button', { name: 'Apply to 2' }))

    await waitFor(() => {
      expect(
        useToastStore.getState().toasts.some((t) => t.title === 'Administrator access required')
      ).toBe(true)
    })
  })

  it('opens the result details dialog from the toast action', async () => {
    const user = userEvent.setup()
    ipc.override('dlss_count_applicable', () => 2)
    ipc.override('dlss_apply_to_all', () => ({
      total: 2,
      succeeded: 1,
      failed: 1,
      results: [
        { gameId: 1, name: 'Elden Ring', ok: true, message: 'Updated' },
        { gameId: 2, name: 'City Skyline X', ok: false, message: 'Access denied' },
      ],
    }))
    renderWithProviders(<GlobalOverridesCard catalog={CATALOG} />)

    const srLabel = await screen.findByText('DLSS Super Resolution')
    const row = srLabel.parentElement as HTMLElement
    await user.click(within(row).getByRole('combobox', { name: 'DLSS Super Resolution' }))
    await user.click(await screen.findByText('v3.7'))
    const applyButtons = await screen.findAllByRole('button', { name: 'Apply to All (2)' })
    await waitFor(() => expect(applyButtons[0]).toBeEnabled())
    await user.click(applyButtons[0])
    await user.click(await screen.findByRole('button', { name: 'Apply to 2' }))

    // The "View details" action lives on the persistent toast (rendered by the
    // global Toaster). Invoke it directly to open the details dialog.
    const toast = await waitFor(() => {
      const found = useToastStore.getState().toasts.find((t) => t.action?.label === 'View details')
      expect(found).toBeDefined()
      return found!
    })
    act(() => toast.action?.onClick())
    expect(await screen.findByText('Apply to All — results')).toBeInTheDocument()
    expect(screen.getByText('City Skyline X')).toBeInTheDocument()
  })

  it('shows a disabled Apply to All with tooltip wrapper when count is 0', async () => {
    ipc.override('dlss_count_applicable', () => 0)
    renderWithProviders(<GlobalOverridesCard catalog={CATALOG} />)
    const buttons = await screen.findAllByRole('button', { name: 'Apply to All (0)' })
    expect(buttons[0]).toBeDisabled()
  })
})
