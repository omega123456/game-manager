import * as React from 'react'

import { SettingsSection } from '@/features/settings/settings-section'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '@/lib/app-log-commands'
import {
  useApplyDlssToAllMutation,
  useDlssApplicableCountQuery,
  useDlssDownloadProgress,
} from '@/lib/queries/use-dlss'
import { DLL_TYPE_LABELS, type BatchApplyResult, type DllCatalog, type DllType } from '@/types/dlss'

import { DllVersionCombobox } from './dll-version-combobox'
import { ApplyToAllDialog } from './apply-to-all-dialog'
import { ApplyToAllResultDialog } from './apply-to-all-result-dialog'
import { isElevationError, showElevationToast } from './elevation-toast'

function isPrivilegeOnlyBatch(result: BatchApplyResult): boolean {
  return (
    result.total > 0 &&
    result.failed === result.total &&
    result.results.every((entry) => entry.ok === false && isElevationError(entry.message ?? ''))
  )
}

interface OverrideRowProps {
  dllType: DllType
  catalog: DllCatalog
  progress: ReturnType<typeof useDlssDownloadProgress>
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

function OverrideRow({
  dllType,
  catalog,
  progress,
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
  const selectedLabel =
    selected === null
      ? 'System Default'
      : (versions.find((entry) => entry.version === selected)?.label ?? selected)

  const canApply = selected !== null && count > 0 && !busy && !applyToAll.isPending

  async function runBatch(): Promise<void> {
    if (selected === null) {
      return
    }
    setConfirmOpen(false)
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
      Apply to All ({count})
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
  const [resultDialog, setResultDialog] = React.useState<BatchApplyResult | null>(null)
  const [resultOpen, setResultOpen] = React.useState(false)

  const showResult = (result: BatchApplyResult): void => {
    setResultDialog(result)
    setResultOpen(true)
  }

  return (
    <SettingsSection
      icon="tune"
      title="Global Overrides"
      description="Replace DLL versions across all applicable games."
    >
      <div className="space-y-6">
        <OverrideRow
          dllType="superResolution"
          catalog={catalog}
          progress={progress}
          onShowResult={showResult}
        />
        <OverrideRow
          dllType="frameGeneration"
          catalog={catalog}
          progress={progress}
          onShowResult={showResult}
        />
        <OverrideRow
          dllType="rayReconstruction"
          catalog={catalog}
          progress={progress}
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
