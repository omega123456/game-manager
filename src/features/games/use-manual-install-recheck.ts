import { useIsMutating } from '@tanstack/react-query'

import { toast, toastError, toastSuccess } from '@/lib/app-log-commands'
import { RECHECK_INSTALLS_MUTATION_KEY, useRecheckInstallsMutation } from '@/lib/queries/use-games'

export interface ManualInstallRecheck {
  /** Re-check every game's launch target and report the result in a toast. */
  recheck: () => void
  /** True while any install recheck (including the startup one) is running. */
  isRechecking: boolean
}

/** A user-triggered install recheck with result toasts. */
export function useManualInstallRecheck(): ManualInstallRecheck {
  const { mutate } = useRecheckInstallsMutation()
  const isRechecking = useIsMutating({ mutationKey: RECHECK_INSTALLS_MUTATION_KEY }) > 0

  function recheck(): void {
    mutate(undefined, {
      onSuccess: (summary) => {
        const missing = summary.missingGameIds.length
        if (missing === 0) {
          toastSuccess('All games found', { category: 'games.install' })
        } else {
          toast('info', `${missing} game${missing === 1 ? '' : 's'} not installed`, {
            category: 'games.install',
          })
        }
      },
      onError: (error: unknown) => {
        toastError('Could not check installs.', {
          category: 'games.install',
          details: error instanceof Error ? error.message : String(error),
        })
      },
    })
  }

  return { recheck, isRechecking }
}
