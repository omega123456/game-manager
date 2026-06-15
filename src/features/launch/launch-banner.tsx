import { AnimatePresence, motion } from 'motion/react'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import { useGamesQuery } from '@/lib/queries/use-games'
import { useLaunchStore } from '@/stores/launch-store'
import type { LiveLaunchPhase } from '@/stores/launch-store'
import { cancelActiveLaunch } from '@/features/launch/launch-controller'
import { formatElapsed, formatLoggedPlaytime, phaseLabel } from '@/features/launch/launch-format'

/**
 * The persistent launch lifecycle banner. Mounts in the fixed slot under the
 * TopBar whenever a launch is active (or a just-ended session is showing its brief
 * "Done" summary). NOT a transient toast — it is a glass status bar driven by the
 * `launch-store` (which is fed by `launch://*` events).
 *
 * Accessibility: `aria-live='polite'` for ongoing transitions; the start and the
 * close (done) states announce assertively. Status is conveyed by an icon + text,
 * never color alone.
 */
export function LaunchBanner(): React.JSX.Element {
  const phase = useLaunchStore((s) => s.phase)
  const gameId = useLaunchStore((s) => s.gameId)
  const gameName = useLaunchStore((s) => s.gameName)
  const detail = useLaunchStore((s) => s.detail)
  const failedCount = useLaunchStore((s) => s.failedCount)
  const elapsedSeconds = useLaunchStore((s) => s.elapsedSeconds)
  const cancelling = useLaunchStore((s) => s.cancelling)
  const done = useLaunchStore((s) => s.done)

  const gamesQuery = useGamesQuery()
  const resolvedName =
    gameName ??
    gamesQuery.data?.find((g) => g.id === (gameId ?? done?.gameId))?.name ??
    'your game'

  const isActive = phase !== 'idle'
  const visible = isActive || done !== null
  // Start and close (done) states are higher-urgency announcements.
  const assertive = phase === 'before' || done !== null

  return (
    <div className="relative z-30">
      <AnimatePresence initial={false}>
        {visible ? (
          <motion.div
            key="launch-banner"
            data-testid="launch-banner"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            role="status"
            aria-live={assertive ? 'assertive' : 'polite'}
            className="border-b border-border bg-surface/80 px-6 py-3 backdrop-blur-md"
          >
            {done ? (
              <DoneRow name={resolvedName} summary={done} />
            ) : (
              <ActiveRow
                phase={phase as ActiveRowPhase}
                name={resolvedName}
                detail={detail}
                elapsedSeconds={elapsedSeconds}
                failedCount={failedCount}
                cancelling={cancelling}
              />
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

/** The phases the active (non-done) banner row renders. */
type ActiveRowPhase = Exclude<LiveLaunchPhase, 'idle' | 'ended'>

interface ActiveRowProps {
  phase: ActiveRowPhase
  name: string
  detail: string | null
  elapsedSeconds: number
  failedCount: number
  cancelling: boolean
}

function ActiveRow({
  phase,
  name,
  detail,
  elapsedSeconds,
  failedCount,
  cancelling,
}: ActiveRowProps): React.JSX.Element {
  const showCounter = phase === 'waitingForProcess' || phase === 'playing'
  const showCancel = phase === 'waitingForProcess' || phase === 'playing'
  const spinning = phase === 'before' || phase === 'waitingForProcess' || phase === 'onExit'

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary',
          spinning && 'motion-safe:animate-spin'
        )}
        data-testid="launch-banner-icon"
      >
        <Icon name={PHASE_ICON[phase]} className="text-[18px]" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {phaseLabel(phase)} <span className="text-muted-foreground">·</span>{' '}
          <span className="text-foreground">{name}</span>
        </p>
        {detail ? <p className="truncate text-xs text-muted-foreground">{detail}</p> : null}
      </div>

      {showCounter ? (
        <span
          className="font-mono text-sm font-semibold tabular-nums text-foreground"
          data-testid="launch-banner-counter"
          aria-label={`Elapsed ${formatElapsed(elapsedSeconds)}`}
        >
          {formatElapsed(elapsedSeconds)}
        </span>
      ) : null}

      {failedCount > 0 ? <FailureNotice failedCount={failedCount} /> : null}

      {showCancel ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={cancelActiveLaunch}
          disabled={cancelling}
          data-testid="launch-banner-cancel"
        >
          <Icon name="cancel" className="text-[16px]" />
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </Button>
      ) : null}
    </div>
  )
}

interface DoneRowProps {
  name: string
  summary: { playtimeSeconds: number; cancelled: boolean }
}

function DoneRow({ name, summary }: DoneRowProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="launch-banner-done">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
        <Icon name="check_circle" className="text-[18px]" />
      </span>
      <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {summary.cancelled ? (
          <>Launch cancelled · {name}</>
        ) : (
          <>
            Session ended · {name}.{' '}
            <span className="text-muted-foreground">
              Playtime logged: {formatLoggedPlaytime(summary.playtimeSeconds)}
            </span>
          </>
        )}
      </p>
    </div>
  )
}

interface FailureNoticeProps {
  failedCount: number
}

function FailureNotice({ failedCount }: FailureNoticeProps): React.JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-foreground"
      data-testid="launch-banner-failure"
      role="note"
    >
      <Icon name="warning" className="text-[15px] text-destructive" />
      {failedCount} {failedCount === 1 ? 'script' : 'scripts'} failed — view details
    </span>
  )
}

const PHASE_ICON: Record<ActiveRowPhase, string> = {
  before: 'autorenew',
  waitingForProcess: 'autorenew',
  playing: 'sports_esports',
  onExit: 'autorenew',
}
