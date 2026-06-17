import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Icon } from '@/components/ui/icon'
import type { PresetOption } from '@/types/dlss'

/** Save-feedback state for a preset control. */
export type PresetSaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface PresetComboboxProps {
  /** Bundled preset options. */
  options: PresetOption[]
  /** Selected preset value. */
  value: number
  /** Called with the chosen preset value (auto-save happens upstream). */
  onChange: (value: number) => void
  /** Accessible label. */
  label: string
  /** Inline save-feedback state. */
  saveState?: PresetSaveState
  /** Disable the control (e.g. unsupported hardware). */
  disabled?: boolean
}

/** Map a preset option to a combobox option (deprecated ones are labelled). */
function toComboboxOption(option: PresetOption): ComboboxOption {
  return {
    value: String(option.value),
    label: option.deprecated ? `${option.name} (deprecated)` : option.name,
  }
}

/**
 * Preset picker with inline save-feedback. Auto-save is driven by the parent
 * (which calls the set-preset mutation); this control reflects the in-flight /
 * saved / error state with a small trailing icon next to the trigger.
 */
export function PresetCombobox({
  options,
  value,
  onChange,
  label,
  saveState = 'idle',
  disabled = false,
}: PresetComboboxProps): React.JSX.Element {
  const comboOptions = options.map(toComboboxOption)

  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <Combobox
          label={label}
          options={comboOptions}
          value={String(value)}
          onChange={(next) => onChange(Number(next))}
          placeholder="Default"
          searchPlaceholder="Search presets…"
          disabled={disabled}
        />
      </div>
      <span
        aria-live="polite"
        className="flex h-5 w-5 shrink-0 items-center justify-center"
        data-testid="preset-save-state"
      >
        {saveState === 'saving' ? (
          <Icon
            name="progress_activity"
            className="animate-spin text-[18px] text-muted-foreground"
            aria-label="Saving preset"
          />
        ) : null}
        {saveState === 'saved' ? (
          <Icon
            name="check_circle"
            filled
            className="text-[18px] text-primary"
            aria-label="Preset saved"
          />
        ) : null}
        {saveState === 'error' ? (
          <Icon
            name="error"
            className="text-[18px] text-destructive"
            aria-label="Preset save failed"
          />
        ) : null}
      </span>
    </div>
  )
}
