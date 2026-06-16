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
import { buttonVariants } from '@/components/ui/button-variants'
import { cancelActiveLaunch } from '@/features/launch/launch-controller'

export type CancelLaunchIntent = 'cancel-launch' | 'stop-game'

interface CancelLaunchConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  gameName: string
  intent: CancelLaunchIntent
  cancelling: boolean
}

const COPY: Record<
  CancelLaunchIntent,
  {
    title: (name: string) => string
    description: string
    dismiss: string
    confirm: string
    confirmPending: string
  }
> = {
  'cancel-launch': {
    title: (name) => `Cancel launch for ${name}?`,
    description:
      'The launch sequence will stop and any running setup scripts will be terminated.',
    dismiss: 'Keep launching',
    confirm: 'Cancel launch',
    confirmPending: 'Cancelling…',
  },
  'stop-game': {
    title: (name) => `Stop ${name}?`,
    description: 'This will end your current session and run any exit scripts.',
    dismiss: 'Keep playing',
    confirm: 'Stop game',
    confirmPending: 'Stopping…',
  },
}

/**
 * Confirmation before cancelling an in-flight launch or stopping an active game session.
 */
export function CancelLaunchConfirmDialog({
  open,
  onOpenChange,
  gameName,
  intent,
  cancelling,
}: CancelLaunchConfirmDialogProps): React.JSX.Element {
  const copy = COPY[intent]

  function handleConfirm(event: React.MouseEvent<HTMLButtonElement>): void {
    event.preventDefault()
    cancelActiveLaunch()
    onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="cancel-launch-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title(gameName)}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancelling}>{copy.dismiss}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: 'destructive' })}
            onClick={handleConfirm}
            disabled={cancelling}
            data-testid="cancel-launch-confirm-action"
          >
            {cancelling ? copy.confirmPending : copy.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
