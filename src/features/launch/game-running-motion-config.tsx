import { MotionConfig } from 'motion/react'

import { isGameRunningPhase, useLaunchStore } from '@/stores/launch-store'

interface GameRunningMotionConfigProps {
  children: React.ReactNode
}

/** Disables motion-driven animations while a game process is active. */
export function GameRunningMotionConfig({
  children,
}: GameRunningMotionConfigProps): React.JSX.Element {
  const isGameRunning = useLaunchStore((state) => isGameRunningPhase(state.phase))

  return (
    <MotionConfig reducedMotion={isGameRunning ? 'always' : 'user'}>{children}</MotionConfig>
  )
}
