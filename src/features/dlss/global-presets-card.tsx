import * as React from 'react'

import { SettingsSection } from '@/features/settings/settings-section'
import { Icon } from '@/components/ui/icon'
import { toastError } from '@/lib/app-log-commands'
import {
  useDlssGlobalPresetQuery,
  useDlssPresetOptionsQuery,
  useSetDlssGlobalPresetMutation,
} from '@/lib/queries/use-dlss'
import type { PresetKind } from '@/types/dlss'

import { PresetCombobox, type PresetSaveState } from './preset-combobox'
import { DlssUnsupportedCallout } from './dlss-unsupported-callout'
import { isElevationError, showElevationToast } from './elevation-toast'

interface PresetRowProps {
  kind: PresetKind
  label: string
  supported: boolean
}

function PresetRow({ kind, label, supported }: PresetRowProps): React.JSX.Element {
  const optionsQuery = useDlssPresetOptionsQuery(kind)
  const presetQuery = useDlssGlobalPresetQuery(kind, supported)
  const setPreset = useSetDlssGlobalPresetMutation()
  const [saveState, setSaveState] = React.useState<PresetSaveState>('idle')
  const resetTimer = React.useRef<number | undefined>(undefined)

  React.useEffect(() => {
    return () => {
      if (resetTimer.current !== undefined) {
        window.clearTimeout(resetTimer.current)
      }
    }
  }, [])

  const options = optionsQuery.data ?? []
  const value = presetQuery.data ?? 0

  async function handleChange(next: number): Promise<void> {
    setSaveState('saving')
    try {
      await setPreset.mutateAsync({ kind, value: next })
      setSaveState('saved')
      resetTimer.current = window.setTimeout(() => setSaveState('idle'), 2000)
    } catch (error: unknown) {
      setSaveState('error')
      if (isElevationError(error)) {
        showElevationToast(error instanceof Error ? error.message : String(error))
      } else {
        toastError(`Could not save the ${label} preset`, {
          category: 'dlss.preset',
          details: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-foreground">{label}</span>
      <PresetCombobox
        label={label}
        options={options}
        value={value}
        onChange={(next) => void handleChange(next)}
        saveState={saveState}
        disabled={!supported}
      />
    </div>
  )
}

export interface GlobalPresetsCardProps {
  /** Whether NVAPI (an NVIDIA GPU) is available. */
  supported: boolean
}

/**
 * Global Presets card: two auto-saving preset selectors (DLSS SR + Ray
 * Reconstruction) writing the NVIDIA global profile, with a persistent
 * "auto-saved" status pill. When NVAPI is unavailable, renders an
 * explain-don't-hide callout and disables the controls.
 */
export function GlobalPresetsCard({ supported }: GlobalPresetsCardProps): React.JSX.Element {
  return (
    <SettingsSection
      icon="settings_suggest"
      title="Global Presets"
      description="Applied to the NVIDIA global profile. Auto-saved."
    >
      <div className="space-y-6">
        {!supported ? <DlssUnsupportedCallout /> : null}
        <PresetRow kind="dlss" label="DLSS Presets (Super Resolution)" supported={supported} />
        <PresetRow
          kind="rayReconstruction"
          label="Ray Reconstruction Presets"
          supported={supported}
        />
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
