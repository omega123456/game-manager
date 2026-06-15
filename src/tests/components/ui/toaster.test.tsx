import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { Toaster } from '@/components/ui/toaster'
import { toast, toastError, toastSuccess } from '@/lib/app-log-commands'
import { useToastStore } from '@/stores/toast-store'

describe('Toaster + toast helpers', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('renders a pushed toast with its description and logs it', () => {
    render(<Toaster />)
    act(() => toast('info', 'Heads up', { description: 'Something happened' }))
    expect(screen.getByText('Heads up')).toBeInTheDocument()
    expect(screen.getByText('Something happened')).toBeInTheDocument()
  })

  it('renders error and success toasts via the convenience helpers', () => {
    render(<Toaster />)
    act(() => {
      toastError('Boom')
      toastSuccess('Saved')
    })
    expect(screen.getByText('Boom')).toBeInTheDocument()
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('dismisses a toast when its close button is clicked', async () => {
    const user = userEvent.setup()
    render(<Toaster />)
    act(() => toast('success', 'Created'))
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    await waitFor(() => expect(screen.queryByText('Created')).not.toBeInTheDocument())
  })
})
