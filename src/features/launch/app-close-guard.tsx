import { useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

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
import { logFrontend } from '@/lib/app-log-commands'
import { useLaunchStore } from '@/stores/launch-store'

/**
 * Intercepts the window close request while a launch is active — covering a
 * running game as well as any in-flight Before/After/OnExit scripts — and
 * asks the user to confirm before quitting, since closing mid-launch would
 * kill the game process and abandon unfinished scripts.
 *
 * `onCloseRequested`'s handler may be async: Tauri awaits it in full before
 * checking `event.isPreventDefault()`, so we hold the promise open until the
 * user decides, then only call `preventDefault()` when they decline to quit.
 * When they confirm, we resolve without preventing default and Tauri's own
 * wrapper destroys the window for us — no manual close()/destroy() call needed.
 */
export function AppCloseGuard(): React.JSX.Element {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const decisionRef = useRef<((confirmed: boolean) => void) | null>(null)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false

    let appWindow: ReturnType<typeof getCurrentWindow>
    try {
      appWindow = getCurrentWindow()
    } catch (err: unknown) {
      logFrontend('warn', `getCurrentWindow unavailable, skipping close guard: ${String(err)}`, {
        category: 'app-close',
      })
      return
    }

    appWindow
      .onCloseRequested(async (event) => {
        if (!useLaunchStore.getState().isActive()) return

        const confirmed = await new Promise<boolean>((resolve) => {
          decisionRef.current = resolve
          setConfirmOpen(true)
        })

        if (!confirmed) {
          event.preventDefault()
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn()
        } else {
          unlisten = fn
        }
      })
      .catch((err: unknown) => {
        logFrontend('error', `failed to register close-requested handler: ${String(err)}`, {
          category: 'app-close',
        })
      })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  function resolveDecision(confirmed: boolean): void {
    decisionRef.current?.(confirmed)
    decisionRef.current = null
    setConfirmOpen(false)
  }

  function handleOpenChange(open: boolean): void {
    if (!open) {
      resolveDecision(false)
    } else {
      setConfirmOpen(true)
    }
  }

  return (
    <AlertDialog open={confirmOpen} onOpenChange={handleOpenChange}>
      <AlertDialogContent data-testid="app-close-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Quit while a game session is active?</AlertDialogTitle>
          <AlertDialogDescription>
            A game or its launch/exit scripts are still running. Quitting now will end the session
            and stop any scripts that haven&apos;t finished.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it running</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: 'destructive' })}
            onClick={() => resolveDecision(true)}
            data-testid="app-close-confirm-action"
          >
            Quit anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
