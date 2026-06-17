import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export interface ApplyToAllDialogProps {
  /** Whether the dialog is open. */
  open: boolean
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void
  /** Display label of the DLL type being applied (e.g. "DLSS Super Resolution"). */
  dllTypeLabel: string
  /** Display version being applied. */
  versionLabel: string
  /** Number of applicable games. */
  count: number
  /** Confirm handler — runs the batch. */
  onConfirm: () => void
}

/**
 * Non-destructive confirmation before an "Apply to All" batch. States the DLL
 * type, version, and how many games are affected, and notes that originals are
 * backed up.
 */
export function ApplyToAllDialog({
  open,
  onOpenChange,
  dllTypeLabel,
  versionLabel,
  count,
  onConfirm,
}: ApplyToAllDialogProps): React.JSX.Element {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Apply {dllTypeLabel} {versionLabel} to all games?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This replaces the current DLL in {count} {count === 1 ? 'game' : 'games'}. Each
            game&apos;s original DLL is backed up.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Apply to {count}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
