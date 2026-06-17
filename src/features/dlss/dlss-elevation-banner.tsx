import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'

import { showElevationToast } from './elevation-toast'

/**
 * Soft, up-front banner shown on the DLSS page when the app is not running
 * elevated. Privileged actions (DLL writes into protected folders, NVAPI preset
 * writes) require Administrator; this offers a one-click relaunch before the
 * user hits a runtime failure. The runtime privilege error remains the
 * authoritative trigger (see {@link showElevationToast}).
 */
export function DlssElevationBanner(): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-high p-4">
      <Icon
        name="admin_panel_settings"
        className="mt-0.5 shrink-0 text-[20px] text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">Administrator access recommended</p>
        <p className="mt-1 text-sm text-muted-foreground">
          DLL files and driver presets often live in protected locations. Relaunch as Administrator
          to apply changes without interruption.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => showElevationToast()}
      >
        Relaunch as Administrator
      </Button>
    </div>
  )
}
