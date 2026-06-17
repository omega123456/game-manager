import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '@/routes/app-routes'
import { LAUNCH_EVENTS } from '@/lib/ipc/launch-commands'
import { useLaunchStore } from '@/stores/launch-store'
import { ipc } from '@/tests/ipc-mock'
import { renderWithProviders, resetUiStore } from '@/tests/helpers/render-app'
import type { LaunchLifecycle } from '@/types/domain'

const GAMES = [
  {
    id: 1,
    name: 'Alan Wake 2',
    launchTarget: 'C:/Games/AlanWake2.exe',
    monitorMode: 'tree' as const,
    imagePath: 'https://example.com/alan-wake-2.png',
    groupIds: [],
    scriptIds: [],
    totalPlaytimeSeconds: 7200,
    lastPlayedAt: '2026-06-10T12:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
]

function event(
  partial: Partial<LaunchLifecycle> & Pick<LaunchLifecycle, 'phase'>
): LaunchLifecycle {
  return { gameId: 1, failedCount: 0, ...partial }
}

/** Wait until the launch event subscription has attached, then emit a phase event. */
async function emitPhase(payload: LaunchLifecycle): Promise<void> {
  await ipc.emit(LAUNCH_EVENTS.phase, payload)
}

describe('LaunchBanner (event-driven)', () => {
  beforeEach(() => {
    resetUiStore()
    useLaunchStore.getState().reset()
    ipc.override('list_games', () => GAMES)
    ipc.override('list_groups', () => [])
    ipc.override('get_game', (args) => GAMES.find((g) => g.id === args?.id) ?? null)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is hidden until a launch event opens a session', async () => {
    renderWithProviders(<AppRoutes />, { route: '/library' })
    await screen.findByText('Alan Wake 2')
    expect(screen.queryByTestId('launch-banner')).not.toBeInTheDocument()
  })

  it('drives the banner through preparing → launching → playing → cleanup', async () => {
    renderWithProviders(<AppRoutes />, { route: '/library' })
    await screen.findByText('Alan Wake 2')

    await emitPhase(event({ phase: 'before', detail: '2/3 scripts' }))
    const banner = await screen.findByTestId('launch-banner')
    await waitFor(() => expect(within(banner).getByText('Preparing')).toBeInTheDocument())
    expect(within(banner).getByText('2/3 scripts')).toBeInTheDocument()

    await emitPhase(event({ phase: 'waitingForProcess', elapsedSeconds: 14 }))
    await waitFor(() => expect(within(banner).getByText('Launching')).toBeInTheDocument())
    expect(screen.getByTestId('launch-banner-counter')).toHaveTextContent('00:14')
    expect(screen.getByTestId('launch-banner-cancel')).toBeInTheDocument()

    await emitPhase(event({ phase: 'playing', elapsedSeconds: 20 }))
    await waitFor(() => expect(within(banner).getByText('Playing')).toBeInTheDocument())
    expect(screen.getByTestId('launch-banner-cancel')).toBeInTheDocument()

    await emitPhase(event({ phase: 'onExit' }))
    await waitFor(() => expect(within(banner).getByText('Cleaning up')).toBeInTheDocument())
  })

  it('shows the currently-playing card pip + ring and the hero timer', async () => {
    renderWithProviders(<AppRoutes />, { route: '/library' })
    await screen.findByText('Alan Wake 2')

    await emitPhase(event({ phase: 'playing', elapsedSeconds: 95 }))

    await waitFor(() => expect(screen.getByTestId('game-card-playing')).toBeInTheDocument())
    expect(screen.getByTestId('game-card-playing-pip')).toHaveTextContent('01:35')
    expect(screen.getByTestId('hero-session-timer')).toHaveTextContent('01:35')
    expect(screen.getByTestId('currently-playing-hero')).toHaveAttribute('data-active', 'true')
  })

  it('renders a non-blocking failure notice without halting the banner', async () => {
    renderWithProviders(<AppRoutes />, { route: '/library' })
    await screen.findByText('Alan Wake 2')

    await ipc.emit(LAUNCH_EVENTS.error, event({ phase: 'before', failedCount: 1 }))

    const notice = await screen.findByTestId('launch-banner-failure')
    expect(notice).toHaveTextContent('1 script failed — view details')
    // The library remains interactive (cards still clickable).
    expect(screen.getByRole('button', { name: 'Open Alan Wake 2' })).toBeEnabled()
  })

  it('ticks the live counter once per second while waiting', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await act(async () => {
      renderWithProviders(<AppRoutes />, { route: '/library' })
    })
    await waitFor(() => expect(screen.getByText('Alan Wake 2')).toBeInTheDocument())

    await emitPhase(event({ phase: 'waitingForProcess', elapsedSeconds: 0 }))
    await waitFor(() => expect(screen.getByTestId('launch-banner-counter')).toBeInTheDocument())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    await waitFor(() => {
      expect(screen.getByTestId('launch-banner-counter')).toHaveTextContent('00:02')
    })
  })

  it('shows the done summary on ended and fades it after the timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await act(async () => {
      renderWithProviders(<AppRoutes />, { route: '/library' })
    })
    await waitFor(() => expect(screen.getByText('Alan Wake 2')).toBeInTheDocument())

    await emitPhase(event({ phase: 'playing', elapsedSeconds: 8040 }))
    await ipc.emit(LAUNCH_EVENTS.ended, event({ phase: 'ended', elapsedSeconds: 8040 }))

    const done = await screen.findByTestId('launch-banner-done')
    expect(done).toHaveTextContent('Playtime logged: 2h 14m')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3200)
    })
    await waitFor(() => expect(screen.queryByTestId('launch-banner')).not.toBeInTheDocument())
  })

  it('cancels via the banner Cancel button', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/library' })
    await screen.findByText('Alan Wake 2')

    await emitPhase(event({ phase: 'waitingForProcess', elapsedSeconds: 1 }))
    const cancel = await screen.findByTestId('launch-banner-cancel')

    await user.click(cancel)
    await user.click(await screen.findByTestId('cancel-launch-confirm-action'))

    await waitFor(() => expect(ipc.calls('cancel_launch')).toEqual([{ gameId: 1 }]))
    expect(screen.getByTestId('launch-banner-cancel')).toHaveTextContent('Cancelling…')
  })

  it('keeps Cancel available during playing while cancellation is still meaningful', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/library' })
    await screen.findByText('Alan Wake 2')

    await emitPhase(event({ phase: 'playing', elapsedSeconds: 30 }))
    const cancel = await screen.findByTestId('launch-banner-cancel')

    await user.click(cancel)
    await user.click(await screen.findByTestId('cancel-launch-confirm-action'))

    await waitFor(() => expect(ipc.calls('cancel_launch')).toEqual([{ gameId: 1 }]))
    expect(screen.getByTestId('launch-banner-cancel')).toHaveTextContent('Cancelling…')
  })
})
