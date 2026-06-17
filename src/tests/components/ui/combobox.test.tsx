import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { renderWithProviders } from '../../helpers/render-app'

const OPTIONS: ComboboxOption[] = [
  { value: 'sd', label: 'System Default', group: 'System Default' },
  { value: '3.7', label: 'v3.7 (Latest)', group: 'Downloaded' },
  { value: '3.8', label: 'v3.8 (New)', group: 'Available', trailing: <span>~45 MB</span> },
]

describe('Combobox', () => {
  it('renders the placeholder when nothing is selected', () => {
    renderWithProviders(
      <Combobox
        options={OPTIONS}
        value={null}
        onChange={vi.fn()}
        label="Version"
        placeholder="Pick one"
      />
    )
    expect(screen.getByRole('combobox', { name: 'Version' })).toHaveTextContent('Pick one')
  })

  it('shows the selected option label', () => {
    renderWithProviders(
      <Combobox options={OPTIONS} value="3.7" onChange={vi.fn()} label="Version" />
    )
    expect(screen.getByRole('combobox', { name: 'Version' })).toHaveTextContent('v3.7 (Latest)')
  })

  it('opens, groups options, and selects on click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(
      <Combobox options={OPTIONS} value={null} onChange={onChange} label="Version" />
    )
    await user.click(screen.getByRole('combobox', { name: 'Version' }))
    expect(await screen.findByText('Downloaded')).toBeInTheDocument()
    expect(screen.getByText('Available')).toBeInTheDocument()
    expect(screen.getByText('~45 MB')).toBeInTheDocument()
    await user.click(screen.getByText('v3.8 (New)'))
    expect(onChange).toHaveBeenCalledWith('3.8')
  })

  it('filters via the search input', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Combobox options={OPTIONS} value={null} onChange={vi.fn()} label="Version" />
    )
    await user.click(screen.getByRole('combobox', { name: 'Version' }))
    const input = await screen.findByPlaceholderText('Search…')
    await user.type(input, '3.8')
    await waitFor(() => {
      expect(screen.queryByText('v3.7 (Latest)')).not.toBeInTheDocument()
    })
    expect(screen.getByText('v3.8 (New)')).toBeInTheDocument()
  })

  it('renders progress content and suppresses the popover when busy', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Combobox
        options={OPTIONS}
        value={null}
        onChange={vi.fn()}
        label="Version"
        progress="Downloading v3.8… 47%"
      />
    )
    const trigger = screen.getByRole('combobox', { name: 'Version' })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveTextContent('Downloading v3.8… 47%')
    await user.click(trigger)
    expect(screen.queryByPlaceholderText('Search…')).not.toBeInTheDocument()
  })

  it('is disabled when disabled prop is set', () => {
    renderWithProviders(
      <Combobox options={OPTIONS} value={null} onChange={vi.fn()} label="Version" disabled />
    )
    expect(screen.getByRole('combobox', { name: 'Version' })).toBeDisabled()
  })
})
