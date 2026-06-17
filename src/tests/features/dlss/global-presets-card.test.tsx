import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { GlobalPresetsCard } from '@/features/dlss/global-presets-card'
import { useToastStore } from '@/stores/toast-store'
import type { PresetOption } from '@/types/dlss'
import { renderWithProviders } from '../../helpers/render-app'
import { ipc } from '../../ipc-mock'

const OPTIONS: PresetOption[] = [
  { value: 0, name: 'Default', deprecated: false },
  { value: 5, name: 'Preset E', deprecated: false },
]

describe('GlobalPresetsCard', () => {
  afterEach(() => useToastStore.setState({ toasts: [] }))

  it('shows the auto-saved status pill', async () => {
    ipc.override('dlss_get_preset_options', () => OPTIONS)
    ipc.override('dlss_get_global_preset', () => 0)
    renderWithProviders(<GlobalPresetsCard supported />)
    expect(await screen.findByText('All changes auto-saved')).toBeInTheDocument()
  })

  it('auto-saves a preset change with saved feedback', async () => {
    const user = userEvent.setup()
    ipc.override('dlss_get_preset_options', () => OPTIONS)
    ipc.override('dlss_get_global_preset', () => 0)
    renderWithProviders(<GlobalPresetsCard supported />)

    const combo = await screen.findByRole('combobox', {
      name: 'DLSS Presets (Super Resolution)',
    })
    await user.click(combo)
    await user.click(await screen.findByText('Preset E'))

    await waitFor(() => {
      expect(ipc.calls('dlss_set_global_preset')).toEqual([{ presetKind: 'dlss', value: 5 }])
    })
    expect(await screen.findByLabelText('Preset saved')).toBeInTheDocument()
  })

  it('shows the unsupported callout and disables controls when not supported', async () => {
    ipc.override('dlss_get_preset_options', () => OPTIONS)
    renderWithProviders(<GlobalPresetsCard supported={false} />)
    expect(await screen.findByText('Requires an NVIDIA GPU')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'DLSS Presets (Super Resolution)' })).toBeDisabled()
  })

  it('surfaces a save error toast', async () => {
    const user = userEvent.setup()
    ipc.override('dlss_get_preset_options', () => OPTIONS)
    ipc.override('dlss_get_global_preset', () => 0)
    ipc.override('dlss_set_global_preset', () => {
      throw new Error('boom')
    })
    renderWithProviders(<GlobalPresetsCard supported />)
    const combo = await screen.findByRole('combobox', {
      name: 'DLSS Presets (Super Resolution)',
    })
    await user.click(combo)
    await user.click(await screen.findByText('Preset E'))
    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.tone === 'error')).toBe(true)
    })
  })
})
