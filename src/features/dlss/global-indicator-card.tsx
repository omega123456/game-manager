import * as React from 'react'

import { Icon } from '@/components/ui/icon'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SettingsSection } from '@/features/settings/settings-section'
import { toastError } from '@/lib/app-log-commands'
import {
  useDlssGlobalIndicatorQuery,
  useSetDlssGlobalIndicatorMutation,
} from '@/lib/queries/use-dlss'
import type { DlssIndicatorMode } from '@/types/dlss'

import { DlssUnsupportedCallout } from './dlss-unsupported-callout'
import { isElevationError, showElevationToast } from './elevation-toast'
import type { PresetSaveState } from './preset-combobox'

const INDICATOR_OPTIONS: Array<{ value: DlssIndicatorMode; label: string; description: string }> = [
  {
    value: 'off',
    label: 'Off',
    description: 'Disable NVIDIA’s DLSS on-screen indicator.',
  },
  {
    value: 'debugDllsOnly',
    label: 'Debug DLLs only',
    description: 'Only show the indicator for developer and debug DLSS DLLs.',
  },
  {
    value: 'allDlssDlls',
    label: 'All DLSS DLLs',
    description: 'Show the indicator for every DLSS DLL NVIDIA loads.',
  },
]

const DLSS_INDICATOR_UNSUPPORTED_MESSAGE = 'NVIDIA NVAPI is unavailable on this system'

function isUnsupportedIndicatorError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return text.includes(DLSS_INDICATOR_UNSUPPORTED_MESSAGE)
}

function SaveStateIcon({ state }: { state: PresetSaveState }): React.JSX.Element {
  return (
    <span
      aria-live="polite"
      className="flex h-5 w-5 shrink-0 items-center justify-center"
      data-testid="indicator-save-state"
    >
      {state === 'saving' ? (
        <Icon
          name="progress_activity"
          className="animate-spin text-[18px] text-muted-foreground"
          aria-label="Saving indicator mode"
        />
      ) : null}
      {state === 'saved' ? (
        <Icon
          name="check_circle"
          filled
          className="text-[18px] text-primary"
          aria-label="Indicator mode saved"
        />
      ) : null}
      {state === 'error' ? (
        <Icon
          name="error"
          className="text-[18px] text-destructive"
          aria-label="Indicator mode save failed"
        />
      ) : null}
    </span>
  )
}

/**
 * Global DLSS indicator card: a three-state, auto-saving selector that mirrors
 * NVIDIA's machine-wide on-screen indicator setting.
 */
export function GlobalIndicatorCard(): React.JSX.Element {
  const indicatorQuery = useDlssGlobalIndicatorQuery()
  const setIndicator = useSetDlssGlobalIndicatorMutation()
  const [saveState, setSaveState] = React.useState<PresetSaveState>('idle')
  const resetTimer = React.useRef<number | undefined>(undefined)

  React.useEffect(() => {
    return () => {
      if (resetTimer.current !== undefined) {
        window.clearTimeout(resetTimer.current)
      }
    }
  }, [])

  const unsupported = indicatorQuery.isError && isUnsupportedIndicatorError(indicatorQuery.error)
  const readError = indicatorQuery.isError && !unsupported
  const indicatorMode = indicatorQuery.data
  const selectValue = indicatorMode ?? ''
  const disabled = unsupported || readError || indicatorQuery.isLoading || setIndicator.isPending

  async function handleChange(next: string): Promise<void> {
    if (indicatorMode === undefined || next === indicatorMode) {
      return
    }

    const mode = next as DlssIndicatorMode
    setSaveState('saving')

    try {
      await setIndicator.mutateAsync(mode)
      setSaveState('saved')
      resetTimer.current = window.setTimeout(() => setSaveState('idle'), 2000)
    } catch (error: unknown) {
      setSaveState('error')
      if (isElevationError(error)) {
        showElevationToast(error instanceof Error ? error.message : String(error))
      } else if (!isUnsupportedIndicatorError(error)) {
        toastError('Could not save the global DLSS indicator mode', {
          category: 'dlss.indicator',
          details: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  const selectedOption = INDICATOR_OPTIONS.find((option) => option.value === indicatorMode)
  const helperText = indicatorQuery.isLoading
    ? 'Reading NVIDIA’s current global indicator mode…'
    : readError
      ? 'Could not read NVIDIA’s current global indicator mode. Try again later.'
      : (selectedOption?.description ?? 'Select indicator mode')

  return (
    <SettingsSection
      icon="visibility"
      title="Global Indicator"
      description="Show NVIDIA’s DLSS on-screen debug indicator. Auto-saved."
    >
      <div className="space-y-6">
        {unsupported ? (
          <DlssUnsupportedCallout
            title="Only available on Windows"
            description="The NVIDIA DLSS indicator is a Windows-only global setting. Game Manager will not attempt registry access on unsupported platforms."
          />
        ) : null}
        {readError ? (
          <DlssUnsupportedCallout
            title="Could not read the current indicator mode"
            description="Game Manager could not load NVIDIA’s current global indicator mode, so changes are temporarily unavailable."
          />
        ) : null}

        <div className="space-y-2">
          <label
            htmlFor="dlss-global-indicator"
            className="block text-sm font-medium text-foreground"
          >
            Show on-screen indicator
          </label>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Select
                value={selectValue}
                onValueChange={(next) => void handleChange(next)}
                disabled={disabled}
              >
                <SelectTrigger id="dlss-global-indicator" aria-label="Show on-screen indicator">
                  <SelectValue placeholder="Select indicator mode" />
                </SelectTrigger>
                <SelectContent>
                  {INDICATOR_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <SaveStateIcon state={saveState} />
          </div>
          <p className="text-sm text-muted-foreground">{helperText}</p>
        </div>

        <div className="flex justify-end">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Icon name="cloud_done" className="text-[16px]" />
            All changes auto-saved
          </span>
        </div>
      </div>
    </SettingsSection>
  )
}
