import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import type { BatchApplyResult } from '@/types/dlss'

export interface ApplyToAllResultDialogProps {
  /** Whether the dialog is open. */
  open: boolean
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void
  /** The batch result to display. */
  result: BatchApplyResult | null
}

/**
 * Per-game results of an "Apply to All" batch, shown from the persistent result
 * toast's "View details" action.
 */
export function ApplyToAllResultDialog({
  open,
  onOpenChange,
  result,
}: ApplyToAllResultDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply to All — results</DialogTitle>
          <DialogDescription>
            {result
              ? `${result.succeeded} of ${result.total} ${result.total === 1 ? 'game' : 'games'} updated.`
              : 'No results available.'}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <ul className="max-h-72 space-y-1 overflow-y-auto" data-testid="apply-result-list">
            {result.results.map((entry) => (
              <li
                key={entry.gameId}
                className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm"
              >
                <Icon
                  name={entry.ok ? 'check_circle' : 'error'}
                  filled={entry.ok}
                  className={entry.ok ? 'text-[18px] text-primary' : 'text-[18px] text-destructive'}
                />
                <span className="min-w-0 flex-1 truncate text-foreground">{entry.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {entry.message ?? (entry.ok ? 'Updated' : 'Failed')}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
