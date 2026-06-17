import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('renders an action button that invokes its handler', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Toaster />)
    act(() =>
      useToastStore.getState().push({
        tone: 'info',
        title: 'Update available',
        action: { label: 'Update now', onClick },
      })
    )
    await user.click(screen.getByRole('button', { name: 'Update now' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  describe('persistent toasts', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('does not auto-dismiss when marked persistent', () => {
      render(<Toaster />)
      let id = 0
      act(() => {
        id = useToastStore.getState().push({ tone: 'info', title: 'Sticky', persistent: true })
      })
      act(() => vi.advanceTimersByTime(10_000))
      expect(screen.getByText('Sticky')).toBeInTheDocument()
      expect(useToastStore.getState().toasts.some((t) => t.id === id)).toBe(true)
    })

    it('auto-dismisses a non-persistent toast after the delay', () => {
      render(<Toaster />)
      let id = 0
      act(() => {
        id = useToastStore.getState().push({ tone: 'info', title: 'Fleeting' })
      })
      act(() => vi.advanceTimersByTime(6_000))
      expect(useToastStore.getState().toasts.some((t) => t.id === id)).toBe(false)
    })
  })
})
