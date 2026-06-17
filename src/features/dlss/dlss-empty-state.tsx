import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'

export interface DlssEmptyStateProps {
  /** Re-scan trigger. */
  onRescan: () => void
  /** Whether a re-scan is currently running. */
  scanning?: boolean
}

/**
 * Shown on the DLSS page when no DLSS-compatible games are detected. Offers a
 * manual re-scan of the library.
 */
export function DlssEmptyState({
  onRescan,
  scanning = false,
}: DlssEmptyStateProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-surface-low p-12 text-center">
      <Icon name="search_off" className="text-[48px] text-muted-foreground" />
      <div>
        <p className="text-base font-medium text-foreground">No DLSS-compatible games detected</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add games with DLSS DLLs, then re-scan your library to manage their versions.
        </p>
      </div>
      <Button type="button" variant="outline" onClick={onRescan} disabled={scanning}>
        <Icon name="refresh" className="text-[18px]" />
        {scanning ? 'Scanning…' : 'Re-scan library'}
      </Button>
    </div>
  )
}
