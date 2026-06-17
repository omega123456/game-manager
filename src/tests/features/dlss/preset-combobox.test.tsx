import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PresetCombobox } from '@/features/dlss/preset-combobox'
import type { PresetOption } from '@/types/dlss'
import { renderWithProviders } from '../../helpers/render-app'

const OPTIONS: PresetOption[] = [
  { value: 0, name: 'Default', deprecated: false },
  { value: 1, name: 'Preset A', deprecated: true },
  { value: 5, name: 'Preset E', deprecated: false },
]

describe('PresetCombobox', () => {
  it('selects a preset by numeric value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <PresetCombobox options={OPTIONS} value={0} onChange={onChange} label="DLSS Preset" />
    )
    await user.click(screen.getByRole('combobox', { name: 'DLSS Preset' }))
    await user.click(await screen.findByText('Preset E'))
    expect(onChange).toHaveBeenCalledWith(5)
  })

  it('labels deprecated presets', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <PresetCombobox options={OPTIONS} value={0} onChange={vi.fn()} label="DLSS Preset" />
    )
    await user.click(screen.getByRole('combobox', { name: 'DLSS Preset' }))
    expect(await screen.findByText('Preset A (deprecated)')).toBeInTheDocument()
  })

  it('shows the saved feedback icon', () => {
    renderWithProviders(
      <PresetCombobox
        options={OPTIONS}
        value={0}
        onChange={vi.fn()}
        label="DLSS Preset"
        saveState="saved"
      />
    )
    expect(screen.getByLabelText('Preset saved')).toBeInTheDocument()
  })

  it('shows the saving feedback icon', () => {
    renderWithProviders(
      <PresetCombobox
        options={OPTIONS}
        value={0}
        onChange={vi.fn()}
        label="DLSS Preset"
        saveState="saving"
      />
    )
    expect(screen.getByLabelText('Saving preset')).toBeInTheDocument()
  })

  it('shows the error feedback icon', () => {
    renderWithProviders(
      <PresetCombobox
        options={OPTIONS}
        value={0}
        onChange={vi.fn()}
        label="DLSS Preset"
        saveState="error"
      />
    )
    expect(screen.getByLabelText('Preset save failed')).toBeInTheDocument()
  })

  it('disables when unsupported', () => {
    renderWithProviders(
      <PresetCombobox options={OPTIONS} value={0} onChange={vi.fn()} label="DLSS Preset" disabled />
    )
    expect(screen.getByRole('combobox', { name: 'DLSS Preset' })).toBeDisabled()
  })
})
