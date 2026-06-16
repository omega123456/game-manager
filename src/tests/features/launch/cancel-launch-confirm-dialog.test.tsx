import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CancelLaunchConfirmDialog } from '@/features/launch/cancel-launch-confirm-dialog'
import { useLaunchStore } from '@/stores/launch-store'
import { ipc } from '@/tests/ipc-mock'
import { renderWithProviders } from '@/tests/helpers/render-app'

describe('CancelLaunchConfirmDialog', () => {
  beforeEach(() => {
    useLaunchStore.getState().reset()
    useLaunchStore.getState().startPreparing(1, 'Alan Wake 2')
  })

  it('confirms a launch cancel and calls cancel_launch', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    renderWithProviders(
      <CancelLaunchConfirmDialog
        open
        onOpenChange={onOpenChange}
        gameName="Alan Wake 2"
        intent="cancel-launch"
        cancelling={false}
      />
    )

    expect(screen.getByText('Cancel launch for Alan Wake 2?')).toBeInTheDocument()
    await user.click(screen.getByTestId('cancel-launch-confirm-action'))

    await expect(ipc.calls('cancel_launch')).toEqual([{ gameId: 1 }])
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('confirms stopping a game session', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <CancelLaunchConfirmDialog
        open
        onOpenChange={() => undefined}
        gameName="Alan Wake 2"
        intent="stop-game"
        cancelling={false}
      />
    )

    expect(screen.getByText('Stop Alan Wake 2?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop game' }))

    await expect(ipc.calls('cancel_launch')).toEqual([{ gameId: 1 }])
  })

  it('dismisses without cancelling when Keep playing is chosen', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <CancelLaunchConfirmDialog
        open
        onOpenChange={() => undefined}
        gameName="Alan Wake 2"
        intent="stop-game"
        cancelling={false}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Keep playing' }))

    expect(ipc.calls('cancel_launch')).toHaveLength(0)
  })
})
