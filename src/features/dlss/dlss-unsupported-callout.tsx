import { Icon } from '@/components/ui/icon'

export interface DlssUnsupportedCalloutProps {
  /** Optional override for the headline. */
  title?: string
  /** Optional override for the supporting copy. */
  description?: string
}

/**
 * Explain-don't-hide callout for the Presets surface when no NVIDIA GPU / NVAPI
 * is available. The preset controls remain rendered (disabled) alongside this.
 */
export function DlssUnsupportedCallout({
  title = 'Requires an NVIDIA GPU',
  description = 'DLSS presets use the NVIDIA API and need a supported NVIDIA card with current drivers installed.',
}: DlssUnsupportedCalloutProps): React.JSX.Element {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-lg border border-border bg-surface-high p-4"
    >
      <Icon name="info" className="mt-0.5 shrink-0 text-[20px] text-muted-foreground" />
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
