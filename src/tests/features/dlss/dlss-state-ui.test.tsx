import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DlssUnsupportedCallout } from '@/features/dlss/dlss-unsupported-callout'
import { DlssEmptyState } from '@/features/dlss/dlss-empty-state'
import { DlssElevationBanner } from '@/features/dlss/dlss-elevation-banner'
import { useToastStore } from '@/stores/toast-store'
import { renderWithProviders } from '../../helpers/render-app'

describe('DlssUnsupportedCallout', () => {
  it('renders default explanatory copy', () => {
    renderWithProviders(<DlssUnsupportedCallout />)
    expect(screen.getByText('Requires an NVIDIA GPU')).toBeInTheDocument()
  })
  it('accepts overrides', () => {
    renderWithProviders(<DlssUnsupportedCallout title="Custom" description="Body" />)
    expect(screen.getByText('Custom')).toBeInTheDocument()
    expect(screen.getByText('Body')).toBeInTheDocument()
  })
})

describe('DlssEmptyState', () => {
  it('renders and triggers a re-scan', async () => {
    const user = userEvent.setup()
    const onRescan = vi.fn()
    renderWithProviders(<DlssEmptyState onRescan={onRescan} />)
    expect(screen.getByText('No DLSS-compatible games detected')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Re-scan library/i }))
    expect(onRescan).toHaveBeenCalledTimes(1)
  })

  it('shows scanning state and disables the button', () => {
    renderWithProviders(<DlssEmptyState onRescan={vi.fn()} scanning />)
    expect(screen.getByRole('button', { name: /Scanning/i })).toBeDisabled()
  })
})

describe('DlssElevationBanner', () => {
  afterEach(() => useToastStore.setState({ toasts: [] }))

  it('shows the relaunch toast on click', async () => {
    const user = userEvent.setup()
    renderWithProviders(<DlssElevationBanner />)
    await user.click(screen.getByRole('button', { name: /Relaunch as Administrator/i }))
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })
})
