import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppCloseGuard } from '@/features/launch/app-close-guard'
import { useLaunchStore } from '@/stores/launch-store'

type CloseRequestedHandler = (event: { preventDefault: () => void }) => Promise<void>

const { onCloseRequestedMock } = vi.hoisted(() => ({
  onCloseRequestedMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: onCloseRequestedMock,
  }),
}))

/**
 * Fires the registered close-requested handler without awaiting its full
 * completion — while a launch is active the handler's promise stays pending
 * until the confirmation dialog is resolved by the user, so awaiting it here
 * would hang the test.
 */
function fireCloseRequested(preventDefault: () => void): void {
  const handler: CloseRequestedHandler = onCloseRequestedMock.mock.calls[0][0]
  act(() => {
    void handler({ preventDefault })
  })
}

describe('AppCloseGuard', () => {
  beforeEach(() => {
    useLaunchStore.getState().reset()
    onCloseRequestedMock.mockReset().mockResolvedValue(() => {})
  })

  it('registers a close-requested handler on mount and unregisters on unmount', async () => {
    const unlisten = vi.fn()
    onCloseRequestedMock.mockResolvedValue(unlisten)

    const { unmount } = render(<AppCloseGuard />)
    await waitFor(() => expect(onCloseRequestedMock).toHaveBeenCalledTimes(1))

    unmount()
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('lets the window close when no launch is active', async () => {
    render(<AppCloseGuard />)
    await waitFor(() => expect(onCloseRequestedMock).toHaveBeenCalledTimes(1))

    const preventDefault = vi.fn()
    const handler: CloseRequestedHandler = onCloseRequestedMock.mock.calls[0][0]
    await act(async () => {
      await handler({ preventDefault })
    })

    expect(preventDefault).not.toHaveBeenCalled()
    expect(screen.queryByTestId('app-close-confirm-dialog')).not.toBeInTheDocument()
  })

  it('blocks the close and shows a confirmation dialog while a launch is active', async () => {
    render(<AppCloseGuard />)
    await waitFor(() => expect(onCloseRequestedMock).toHaveBeenCalledTimes(1))

    act(() => {
      useLaunchStore.getState().startPreparing(1, 'Alan Wake 2')
    })

    const preventDefault = vi.fn()
    fireCloseRequested(preventDefault)

    expect(await screen.findByTestId('app-close-confirm-dialog')).toBeInTheDocument()
    // The decision is still pending — nothing has been prevented or allowed yet.
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('lets the close proceed (no preventDefault) when the user confirms quitting', async () => {
    const user = userEvent.setup()
    render(<AppCloseGuard />)
    await waitFor(() => expect(onCloseRequestedMock).toHaveBeenCalledTimes(1))

    act(() => {
      useLaunchStore.getState().startPreparing(1, 'Alan Wake 2')
    })
    const preventDefault = vi.fn()
    fireCloseRequested(preventDefault)
    await screen.findByTestId('app-close-confirm-dialog')

    await user.click(screen.getByTestId('app-close-confirm-action'))

    await waitFor(() =>
      expect(screen.queryByTestId('app-close-confirm-dialog')).not.toBeInTheDocument()
    )
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('stays blocking through the onExit phase and only releases once the run has ended', async () => {
    const user = userEvent.setup()
    render(<AppCloseGuard />)
    await waitFor(() => expect(onCloseRequestedMock).toHaveBeenCalledTimes(1))

    act(() => {
      useLaunchStore.getState().applyLifecycle({
        gameId: 1,
        phase: 'onExit',
        failedCount: 0,
        elapsedSeconds: 120,
      })
    })
    expect(useLaunchStore.getState().isActive()).toBe(true)

    const preventDefault = vi.fn()
    fireCloseRequested(preventDefault)

    // Still running on-exit scripts — the guard must show the confirmation,
    // not let the close proceed silently.
    expect(await screen.findByTestId('app-close-confirm-dialog')).toBeInTheDocument()
    expect(preventDefault).not.toHaveBeenCalled()

    await user.click(screen.getByText('Keep it running'))
    await waitFor(() =>
      expect(screen.queryByTestId('app-close-confirm-dialog')).not.toBeInTheDocument()
    )

    // Only once the backend reports the run as fully ended does the store go idle.
    act(() => {
      useLaunchStore.getState().applyLifecycle({
        gameId: 1,
        phase: 'ended',
        failedCount: 0,
        elapsedSeconds: 120,
      })
    })
    expect(useLaunchStore.getState().isActive()).toBe(false)

    const secondPreventDefault = vi.fn()
    const handler: CloseRequestedHandler = onCloseRequestedMock.mock.calls[0][0]
    await act(async () => {
      await handler({ preventDefault: secondPreventDefault })
    })
    expect(secondPreventDefault).not.toHaveBeenCalled()
  })

  it('prevents the close when the user dismisses the dialog', async () => {
    const user = userEvent.setup()
    render(<AppCloseGuard />)
    await waitFor(() => expect(onCloseRequestedMock).toHaveBeenCalledTimes(1))

    act(() => {
      useLaunchStore.getState().startPreparing(1, 'Alan Wake 2')
    })
    const preventDefault = vi.fn()
    fireCloseRequested(preventDefault)
    await screen.findByTestId('app-close-confirm-dialog')

    await user.click(screen.getByText('Keep it running'))

    await waitFor(() =>
      expect(screen.queryByTestId('app-close-confirm-dialog')).not.toBeInTheDocument()
    )
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })
})
