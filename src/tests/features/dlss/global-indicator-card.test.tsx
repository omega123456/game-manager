import type { ReactElement } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { ThemeProvider } from '@/components/theme/theme-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { GlobalIndicatorCard } from '@/features/dlss/global-indicator-card'
import { useToastStore } from '@/stores/toast-store'
import { renderWithProviders } from '../../helpers/render-app'
import { ipc } from '../../ipc-mock'

function renderWithNoRetry(ui: ReactElement): void {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <MemoryRouter initialEntries={['/dlss']}>
          <ThemeProvider>{ui}</ThemeProvider>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

describe('GlobalIndicatorCard', () => {
  afterEach(() => useToastStore.setState({ toasts: [] }))

  it('shows the current indicator mode and auto-saved status pill', async () => {
    ipc.override('dlss_get_global_indicator', () => 'debugDllsOnly')
    renderWithProviders(<GlobalIndicatorCard />)

    expect(await screen.findByText('Global Indicator')).toBeInTheDocument()
    expect(
      await screen.findByRole('combobox', { name: 'Show on-screen indicator' })
    ).toHaveTextContent('Debug DLLs only')
    expect(await screen.findByText('All changes auto-saved')).toBeInTheDocument()
  })

  it('auto-saves a mode change with saved feedback', async () => {
    const user = userEvent.setup()
    ipc.override('dlss_get_global_indicator', () => 'off')
    renderWithProviders(<GlobalIndicatorCard />)

    const combo = await screen.findByRole('combobox', { name: 'Show on-screen indicator' })
    await user.click(combo)
    await user.click(await screen.findByText('All DLSS DLLs'))

    await waitFor(() => {
      expect(ipc.calls('dlss_set_global_indicator')).toEqual([{ mode: 'allDlssDlls' }])
    })
    expect(await screen.findByLabelText('Indicator mode saved')).toBeInTheDocument()
  })

  it('shows a Windows-only unsupported callout and disables the control', async () => {
    ipc.override('dlss_get_global_indicator', () => {
      throw new Error('NVIDIA NVAPI is unavailable on this system')
    })
    renderWithNoRetry(<GlobalIndicatorCard />)

    expect(await screen.findByText('Only available on Windows')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Show on-screen indicator' })).toBeDisabled()
  })

  it('shows a read-error state for failed indicator reads and disables the control', async () => {
    ipc.override('dlss_get_global_indicator', () => {
      throw new Error('Registry read failed')
    })
    renderWithNoRetry(<GlobalIndicatorCard />)

    expect(await screen.findByText('Could not read the current indicator mode')).toBeInTheDocument()
    expect(
      screen.getByText('Could not read NVIDIA’s current global indicator mode. Try again later.')
    ).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Show on-screen indicator' })).toBeDisabled()
    expect(ipc.calls('dlss_set_global_indicator')).toEqual([])
  })

  it('routes privilege failures to the elevation toast', async () => {
    const user = userEvent.setup()
    ipc.override('dlss_get_global_indicator', () => 'off')
    ipc.override('dlss_set_global_indicator', () => {
      throw new Error('Access denied')
    })
    renderWithProviders(<GlobalIndicatorCard />)

    const combo = await screen.findByRole('combobox', { name: 'Show on-screen indicator' })
    await user.click(combo)
    await user.click(await screen.findByText('Debug DLLs only'))

    await waitFor(() => {
      expect(
        useToastStore
          .getState()
          .toasts.some((toast) => toast.title === 'Administrator access required')
      ).toBe(true)
    })
    expect(await screen.findByLabelText('Indicator mode save failed')).toBeInTheDocument()
  })

  it('surfaces a generic save failure toast', async () => {
    const user = userEvent.setup()
    ipc.override('dlss_get_global_indicator', () => 'off')
    ipc.override('dlss_set_global_indicator', () => {
      throw new Error('boom')
    })
    renderWithProviders(<GlobalIndicatorCard />)

    const combo = await screen.findByRole('combobox', { name: 'Show on-screen indicator' })
    await user.click(combo)
    await user.click(await screen.findByText('Debug DLLs only'))

    await waitFor(() => {
      expect(
        useToastStore
          .getState()
          .toasts.some(
            (toast) =>
              toast.tone === 'error' &&
              toast.title === 'Could not save the global DLSS indicator mode'
          )
      ).toBe(true)
    })
  })
})
