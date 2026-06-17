import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Toaster } from '@/components/ui/toaster'
import { UpdateToast } from '@/features/updates/update-toast'
import { useToastStore } from '@/stores/toast-store'
import { useUpdateStore } from '@/stores/update-store'

function renderUpdateToast() {
  return render(
    <>
      <UpdateToast />
      <Toaster />
    </>
  )
}

describe('UpdateToast', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    useUpdateStore.setState({
      status: 'idle',
      availableVersion: null,
      downloadProgress: 0,
      errorMessage: null,
      hasCheckedOnStartup: true,
      updateObject: null,
    })
  })

  it('shows a persistent update toast when an update becomes available', async () => {
    renderUpdateToast()
    expect(screen.queryByText('Update available')).not.toBeInTheDocument()

    act(() => useUpdateStore.setState({ status: 'available', availableVersion: '2.0.0' }))

    expect(await screen.findByText('Update available')).toBeInTheDocument()
    expect(screen.getByText('Version 2.0.0 is ready to install.')).toBeInTheDocument()
    expect(useToastStore.getState().toasts[0]?.persistent).toBe(true)
  })

  it('runs downloadAndInstall when the toast action is clicked', async () => {
    const user = userEvent.setup()
    const downloadAndInstall = vi.fn(() => Promise.resolve())
    useUpdateStore.setState({ downloadAndInstall })
    renderUpdateToast()

    act(() => useUpdateStore.setState({ status: 'available', availableVersion: '2.0.0' }))

    await user.click(await screen.findByRole('button', { name: 'Update now' }))
    expect(downloadAndInstall).toHaveBeenCalledTimes(1)
  })

  it('removes the toast once the updater leaves the available state', async () => {
    renderUpdateToast()
    act(() => useUpdateStore.setState({ status: 'available', availableVersion: '2.0.0' }))
    expect(await screen.findByText('Update available')).toBeInTheDocument()

    act(() => useUpdateStore.setState({ status: 'installing' }))

    await waitFor(() => expect(screen.queryByText('Update available')).not.toBeInTheDocument())
  })
})
