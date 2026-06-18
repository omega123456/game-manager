import * as React from 'react'

import { SettingsSection } from '@/features/settings/settings-section'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '@/lib/app-log-commands'
import {
  useApplyDlssToAllMutation,
  useDlssApplicableCountQuery,
  useDlssApplyProgress,
  useDlssDownloadProgress,
} from '@/lib/queries/use-dlss'
import {
  DLL_TYPE_LABELS,
  type ApplyResult,
  type BatchApplyResult,
  type DllCatalog,
  type DllType,
} from '@/types/dlss'

import { ApplyToAllDialog } from './apply-to-all-dialog'
import { ApplyToAllResultDialog } from './apply-to-all-result-dialog'
import { DllVersionCombobox } from './dll-version-combobox'
import { isElevationError, showElevationToast } from './elevation-toast'

function isPrivilegeOnlyBatch(result: BatchApplyResult): boolean {
  return (
    result.total > 0 &&
    result.failed === result.total &&
    result.results.every((entry) => entry.ok === false && isElevationError(entry.message ?? ''))
  )
}

interface ActiveBatchState {
  dllType: DllType
  dllTypeLabel: string
  versionLabel: string
  total: number
}

interface OverrideRowProps {
  dllType: DllType
  catalog: DllCatalog
  progress: ReturnType<typeof useDlssDownloadProgress>
  batchActive: boolean
  activeBatchType: DllType | null
  onBatchStart: (batch: ActiveBatchState) => void
  onBatchFinish: () => void
  onShowResult: (result: BatchApplyResult) => void
}

const CATALOG_KEY: Record<
  DllType,
  keyof Pick<DllCatalog, 'superResolution' | 'frameGeneration' | 'rayReconstruction'>
> = {
  superResolution: 'superResolution',
  frameGeneration: 'frameGeneration',
  rayReconstruction: 'rayReconstruction',
}

function ApplyProgressPanel({
  batch,
  results,
}: {
  batch: ActiveBatchState
  results: ApplyResult[]
}): React.JSX.Element {
  const processed = Math.min(results.length, batch.total)
  const succeeded = results.filter((entry) => entry.ok).length
  const failed = processed - succeeded
  const latest = results.length > 0 ? results[results.length - 1] : null
  const percent = batch.total > 0 ? Math.round((processed / batch.total) * 100) : 0

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="apply-progress-panel"
      className="rounded-[1.25rem] border border-border bg-surface-container p-4"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon name="downloading" className="motion-safe:animate-spin text-[20px]" />
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Applying {batch.dllTypeLabel}</p>
              <p className="truncate text-sm text-muted-foreground">
                {batch.versionLabel} across {batch.total} {batch.total === 1 ? 'game' : 'games'}
              </p>
            </div>
            <p className="shrink-0 text-sm text-muted-foreground">
              {processed} of {batch.total} complete
            </p>
          </div>
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-surface-high">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{succeeded} updated</span>
              <span>{failed} issues</span>
              <span>
                {latest
                  ? `${latest.ok ? 'Latest' : 'Needs attention'}: ${latest.name}`
                  : 'Preparing first game…'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function OverrideRow({
  dllType,
  catalog,
  progress,
  batchActive,
  activeBatchType,
  onBatchStart,
  onBatchFinish,
  onShowResult,
}: OverrideRowProps): React.JSX.Element {
  const versions = catalog[CATALOG_KEY[dllType]]
  const countQuery = useDlssApplicableCountQuery(dllType)
  const applyToAll = useApplyDlssToAllMutation()
  const [selected, setSelected] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  const count = countQuery.data ?? 0
  const label = DLL_TYPE_LABELS[dllType]
  const isApplying = activeBatchType === dllType
  const selectedLabel =
    selected === null
      ? 'System Default'
      : (versions.find((entry) => entry.version === selected)?.label ?? selected)

  const canApply = selected !== null && count > 0 && !busy && !applyToAll.isPending && !batchActive

  async function runBatch(): Promise<void> {
    if (selected === null) {
      return
    }
    setConfirmOpen(false)
    onBatchStart({
      dllType,
      dllTypeLabel: label,
      versionLabel: selectedLabel,
      total: count,
    })
    try {
      const result = await applyToAll.mutateAsync({ dllType, version: selected })
      if (isPrivilegeOnlyBatch(result)) {
        showElevationToast(result.results[0]?.message)
      }
      const summary =
        result.failed === 0
          ? `${label} updated — ${result.succeeded} of ${result.total} games.`
          : `${label} updated — ${result.succeeded} of ${result.total} games. ${result.failed} could not be reached.`
      toast(result.failed === 0 ? 'success' : 'info', summary, {
        category: 'dlss.apply-all',
        persistent: true,
        action: {
          label: 'View details',
          onClick: () => onShowResult(result),
        },
      })
    } catch (error: unknown) {
      if (isElevationError(error)) {
        showElevationToast(error instanceof Error ? error.message : String(error))
      } else {
        toast('error', `Could not apply ${label} to all games`, {
          category: 'dlss.apply-all',
          details: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      onBatchFinish()
    }
  }

  const applyButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={!canApply}
      onClick={() => setConfirmOpen(true)}
    >
      {isApplying ? 'Applying…' : `Apply to All (${count})`}
    </Button>
  )

  return (
    <div className="space-y-2">
      <span id={`override-${dllType}-label`} className="block text-sm font-medium text-foreground">
        {label}
      </span>
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <DllVersionCombobox
            dllType={dllType}
            versions={versions}
            value={selected}
            onChange={setSelected}
            label={label}
            progress={progress.progress}
            onClearProgress={progress.clear}
            onBusyChange={setBusy}
            disabled={batchActive}
          />
        </div>
        {count === 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{applyButton}</span>
            </TooltipTrigger>
            <TooltipContent>No games with this DLL detected</TooltipContent>
          </Tooltip>
        ) : (
          applyButton
        )}
      </div>
      <ApplyToAllDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        dllTypeLabel={label}
        versionLabel={selectedLabel}
        count={count}
        onConfirm={() => void runBatch()}
      />
    </div>
  )
}

export interface GlobalOverridesCardProps {
  /** The resolved version catalog. */
  catalog: DllCatalog
}

/**
 * Global Overrides card: three version rows, each with an "Apply to All (N)"
 * action that confirms then swaps the chosen DLL across all applicable games.
 */
export function GlobalOverridesCard({ catalog }: GlobalOverridesCardProps): React.JSX.Element {
  const progress = useDlssDownloadProgress()
  const applyProgress = useDlssApplyProgress()
  const [resultDialog, setResultDialog] = React.useState<BatchApplyResult | null>(null)
  const [resultOpen, setResultOpen] = React.useState(false)
  const [activeBatch, setActiveBatch] = React.useState<ActiveBatchState | null>(null)

  const showResult = (result: BatchApplyResult): void => {
    setResultDialog(result)
    setResultOpen(true)
  }

  const handleBatchStart = (batch: ActiveBatchState): void => {
    applyProgress.reset()
    setActiveBatch(batch)
  }

  const handleBatchFinish = (): void => {
    setActiveBatch(null)
  }

  return (
    <SettingsSection
      icon="tune"
      title="Global Overrides"
      description="Replace DLL versions across all applicable games."
    >
      <div className="space-y-6">
        {activeBatch ? (
          <ApplyProgressPanel batch={activeBatch} results={applyProgress.results} />
        ) : null}
        <OverrideRow
          dllType="superResolution"
          catalog={catalog}
          progress={progress}
          batchActive={activeBatch !== null}
          activeBatchType={activeBatch?.dllType ?? null}
          onBatchStart={handleBatchStart}
          onBatchFinish={handleBatchFinish}
          onShowResult={showResult}
        />
        <OverrideRow
          dllType="frameGeneration"
          catalog={catalog}
          progress={progress}
          batchActive={activeBatch !== null}
          activeBatchType={activeBatch?.dllType ?? null}
          onBatchStart={handleBatchStart}
          onBatchFinish={handleBatchFinish}
          onShowResult={showResult}
        />
        <OverrideRow
          dllType="rayReconstruction"
          catalog={catalog}
          progress={progress}
          batchActive={activeBatch !== null}
          activeBatchType={activeBatch?.dllType ?? null}
          onBatchStart={handleBatchStart}
          onBatchFinish={handleBatchFinish}
          onShowResult={showResult}
        />
      </div>
      <ApplyToAllResultDialog
        open={resultOpen}
        onOpenChange={setResultOpen}
        result={resultDialog}
      />
    </SettingsSection>
  )
}
