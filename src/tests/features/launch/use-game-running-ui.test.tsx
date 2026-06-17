import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useGameRunningUi } from '@/features/launch/use-game-running-ui'
import { useLaunchStore } from '@/stores/launch-store'

function Harness(): React.JSX.Element {
  useGameRunningUi()
  return <div />
}

describe('useGameRunningUi', () => {
  beforeEach(() => {
    useLaunchStore.getState().reset()
    document.documentElement.classList.remove('game-running')
  })

  it('adds game-running on the document root while phase is playing', () => {
    render(<Harness />)

    act(() => {
      useLaunchStore.getState().applyLifecycle({
        gameId: 1,
        phase: 'playing',
        failedCount: 0,
        elapsedSeconds: 0,
      })
    })

    expect(document.documentElement.classList.contains('game-running')).toBe(true)
  })

  it('removes game-running when the phase leaves playing', () => {
    render(<Harness />)

    act(() => {
      useLaunchStore.getState().applyLifecycle({
        gameId: 1,
        phase: 'playing',
        failedCount: 0,
        elapsedSeconds: 0,
      })
    })
    expect(document.documentElement.classList.contains('game-running')).toBe(true)

    act(() => {
      useLaunchStore.getState().applyLifecycle({
        gameId: 1,
        phase: 'onExit',
        failedCount: 0,
        elapsedSeconds: 10,
      })
    })

    expect(document.documentElement.classList.contains('game-running')).toBe(false)
  })

  it('cleans up game-running on unmount', () => {
    const { unmount } = render(<Harness />)

    act(() => {
      useLaunchStore.getState().applyLifecycle({
        gameId: 1,
        phase: 'playing',
        failedCount: 0,
        elapsedSeconds: 0,
      })
    })
    expect(document.documentElement.classList.contains('game-running')).toBe(true)

    unmount()

    expect(document.documentElement.classList.contains('game-running')).toBe(false)
  })
})
