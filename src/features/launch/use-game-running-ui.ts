import { useEffect } from 'react'

import { isGameRunningPhase, useLaunchStore } from '@/stores/launch-store'

/**
 * While a game process is running, mark the document root so global CSS can
 * disable transitions/animations and MotionConfig can freeze JS-driven motion.
 */
export function useGameRunningUi(): void {
  const phase = useLaunchStore((state) => state.phase)

  useEffect(() => {
    const isRunning = isGameRunningPhase(phase)
    document.documentElement.classList.toggle('game-running', isRunning)

    return () => {
      document.documentElement.classList.remove('game-running')
    }
  }, [phase])
}
