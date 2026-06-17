import { relaunchElevated } from '@/lib/ipc/dlss-commands'
import { logFrontend, toastError } from '@/lib/app-log-commands'

/** Heuristic: does this error look like a privilege/elevation failure? */
export function isElevationError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return /privilege|administrator|access denied|elevation|requires elevation/i.test(text)
}

/**
 * Surface the recoverable "Administrator access required" toast with a one-click
 * "Relaunch as Administrator" action. Persistent (stays until acted on). Logged
 * via the toast helper. Calling the action relaunches the app elevated; on
 * failure it logs (the process would normally not return on success).
 */
export function showElevationToast(details?: string): void {
  toastError('Administrator access required', {
    description: 'These changes touch protected files or driver settings. Relaunch to apply them.',
    category: 'dlss.elevation',
    details,
    persistent: true,
    action: {
      label: 'Relaunch as Administrator',
      onClick: () => {
        void relaunchElevated().catch((error: unknown) => {
          logFrontend('error', 'Relaunch as Administrator failed.', {
            category: 'dlss.elevation',
            details: error instanceof Error ? error.message : String(error),
          })
        })
      },
    },
  })
}
