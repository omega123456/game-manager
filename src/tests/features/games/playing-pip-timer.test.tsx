import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { PlayingPipTimer } from '@/features/games/playing-pip-timer'
import { useLaunchStore } from '@/stores/launch-store'

describe('PlayingPipTimer', () => {
  afterEach(() => {
    act(() => {
      useLaunchStore.getState().reset()
    })
  })

  it('renders the formatted live elapsed time from the launch store', () => {
    act(() => {
      useLaunchStore.setState({ gameId: 1, phase: 'playing', elapsedSeconds: 95 })
    })
    render(<PlayingPipTimer />)
    expect(screen.getByText('01:35')).toBeInTheDocument()
  })

  it('updates when the launch store ticks', () => {
    act(() => {
      useLaunchStore.setState({ gameId: 1, phase: 'playing', elapsedSeconds: 0 })
    })
    render(<PlayingPipTimer />)
    expect(screen.getByText('00:00')).toBeInTheDocument()

    act(() => {
      useLaunchStore.getState().tick()
    })
    expect(screen.getByText('00:01')).toBeInTheDocument()
  })
})
