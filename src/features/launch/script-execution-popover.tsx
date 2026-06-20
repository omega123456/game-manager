import type { ReactElement } from 'react'

import { Badge } from '@/components/ui/badge'
import { Icon } from '@/components/ui/icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLatestLaunchRunQuery } from '@/lib/queries/use-games'
import { cn } from '@/lib/utils'
import type { LaunchScriptRecord } from '@/types/domain'

import {
  SCRIPT_EXECUTION_PHASE_ORDER,
  type ScriptExecutionPhaseMeta,
  formatScriptProvenance,
  formatScriptUtilityMeta,
  getScriptExecutionViewMeta,
  groupScriptRecordsByPhase,
  phaseMeta,
  scriptRecordTiming,
  statusMeta,
} from './script-execution-format'

function statusBadgeClassName(status: LaunchScriptRecord['status']): string {
  switch (status) {
    case 'succeeded':
      return 'border-emerald-500/25 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
    case 'failed':
      return 'border-destructive/35 bg-destructive/12 text-destructive'
    case 'pending':
      return 'border-amber-500/25 bg-amber-500/12 text-amber-700 dark:text-amber-300'
    case 'running':
      return 'border-primary/30 bg-primary/10 text-primary'
    case 'notReached':
      return 'border-border/80 bg-surface-high/80 text-muted-foreground'
  }
}

export interface ScriptExecutionPopoverProps {
  gameId: number | null | undefined
  gameName?: string
  trigger: ReactElement
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}

function ScriptExecutionRow({ record }: { record: LaunchScriptRecord }): React.JSX.Element {
  const status = statusMeta(record.status)
  const timing = scriptRecordTiming(record)
  return (
    <li
      className={cn(
        'rounded-xl border border-border/80 bg-surface/70 px-3 py-3 shadow-[0_10px_30px_-18px_hsl(var(--primary)/0.4)]',
        record.status === 'running' && 'border-primary/40 bg-primary/5'
      )}
      data-testid={`script-execution-row-${record.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/80 bg-surface-high/70 text-muted-foreground">
            <Icon name={status.icon} className="text-[18px]" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-semibold text-foreground">{record.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatScriptProvenance(record.provenance, record.groupName)} ·{' '}
              {formatScriptUtilityMeta(record.requiredUtilityNames)}
            </p>
            {record.details ? (
              <p className="text-xs text-muted-foreground">{record.details}</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge
            variant="outline"
            className={cn(
              'px-2 py-1 text-[11px] font-medium uppercase tracking-[0.18em]',
              statusBadgeClassName(record.status)
            )}
            data-testid={`script-execution-status-${record.id}`}
          >
            {status.label}
          </Badge>
          {timing.kind !== 'none' ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums',
                timing.kind === 'elapsed'
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border/70 bg-surface-high/70 text-muted-foreground'
              )}
              data-testid={`script-execution-timing-${record.id}`}
            >
              <Icon
                name={timing.kind === 'elapsed' ? 'timer' : 'schedule'}
                className="text-[13px]"
              />
              {timing.label}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  )
}

function ScriptPhaseSection({
  phase,
  records,
}: {
  phase: ScriptExecutionPhaseMeta
  records: LaunchScriptRecord[]
}): React.JSX.Element {
  return (
    <section className="space-y-2" data-testid={`script-phase-${phase.phase}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon name={phase.icon} className="text-base text-muted-foreground" />
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {phase.label}
          </h3>
        </div>
        <span className="rounded-full border border-border/70 bg-surface-high/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          {records.length}
        </span>
      </div>
      {records.length > 0 ? (
        <ul className="space-y-2">
          {records.map((record) => (
            <ScriptExecutionRow key={record.id} record={record} />
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-border/70 bg-surface/50 px-3 py-3 text-sm text-muted-foreground">
          {phase.emptyLabel}
        </div>
      )}
    </section>
  )
}

function ScriptExecutionContent({
  gameName,
  isLoading,
  isError,
  errorMessage,
  records,
  viewMeta,
}: {
  gameName?: string
  isLoading: boolean
  isError: boolean
  errorMessage: string
  records: LaunchScriptRecord[]
  viewMeta: {
    state: 'loading' | 'empty' | 'live' | 'retained'
    label: string
    summary: string
  }
}): React.JSX.Element {
  const grouped = groupScriptRecordsByPhase(records)

  return (
    <div className="w-[min(26rem,calc(100vw-2rem))] space-y-4 rounded-2xl border border-border/80 bg-popover/95 p-4 text-popover-foreground shadow-[0_18px_60px_-24px_hsl(var(--primary)/0.35)] backdrop-blur-xl">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-primary/10 text-primary">
              <Icon name="deployed_code" className="text-[18px]" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">Execution pipeline</p>
              <p className="text-xs text-muted-foreground">{gameName ?? 'Selected game'}</p>
            </div>
          </div>
          <span
            className={cn(
              'rounded-full border px-2 py-1 font-mono text-[11px] uppercase tracking-[0.18em]',
              viewMeta.state === 'live'
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border/70 bg-surface-high/80 text-muted-foreground'
            )}
          >
            {viewMeta.label}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{viewMeta.summary}</p>
      </header>

      {isLoading ? (
        <div
          className="rounded-xl border border-border/70 bg-surface/60 px-3 py-4 text-sm text-muted-foreground"
          data-testid="script-execution-loading"
        >
          Loading script execution details…
        </div>
      ) : null}

      {isError ? (
        <div
          className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-4 text-sm text-foreground"
          data-testid="script-execution-error"
        >
          {errorMessage}
        </div>
      ) : null}

      {!isLoading && !isError ? (
        <div className="space-y-4">
          {SCRIPT_EXECUTION_PHASE_ORDER.map((phase) => (
            <ScriptPhaseSection key={phase} phase={phaseMeta(phase)} records={grouped[phase]} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function ScriptExecutionPopover({
  gameId,
  gameName,
  trigger,
  align = 'end',
  sideOffset = 8,
}: ScriptExecutionPopoverProps): React.JSX.Element {
  const query = useLatestLaunchRunQuery(gameId)
  const records = query.data?.scriptRecords ?? []
  const viewMeta = getScriptExecutionViewMeta({
    isLoading: query.isLoading,
    run: query.data,
  })
  const errorMessage =
    query.error instanceof Error ? query.error.message : 'Could not load script execution details.'

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={sideOffset}
        className="w-auto rounded-2xl border-none bg-transparent p-0 shadow-none"
      >
        <ScriptExecutionContent
          gameName={gameName}
          isLoading={query.isLoading}
          isError={query.isError}
          errorMessage={errorMessage}
          records={records}
          viewMeta={viewMeta}
        />
      </PopoverContent>
    </Popover>
  )
}
