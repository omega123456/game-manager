import { useEffect, useRef } from 'react'

import { useToastStore } from '@/stores/toast-store'
import { useUpdateStore } from '@/stores/update-store'

/**
 * Headless watcher that surfaces a persistent (dismissible, non auto-dismissing)
 * toast whenever the updater reports a newer release is available on startup.
 *
 * The toast's action button mirrors the "Update now" control in the settings
 * Updates section — it kicks off `downloadAndInstall`, so the user can update
 * without opening Settings. Once the updater leaves the `available` state
 * (download started, already up to date, or error) the toast is removed.
 */
export function UpdateToast(): null {
  const status = useUpdateStore((state) => state.status)
  const availableVersion = useUpdateStore((state) => state.availableVersion)
  const downloadAndInstall = useUpdateStore((state) => state.downloadAndInstall)
  const push = useToastStore((state) => state.push)
  const dismiss = useToastStore((state) => state.dismiss)
  const toastIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (status === 'available') {
      if (toastIdRef.current === null) {
        toastIdRef.current = push({
          tone: 'info',
          title: 'Update available',
          description: `Version ${availableVersion ?? 'new'} is ready to install.`,
          persistent: true,
          action: {
            label: 'Update now',
            onClick: () => void downloadAndInstall(),
          },
        })
      }
      return
    }

    if (toastIdRef.current !== null) {
      dismiss(toastIdRef.current)
      toastIdRef.current = null
    }
  }, [status, availableVersion, downloadAndInstall, push, dismiss])

  return null
}
