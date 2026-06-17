import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import { useToastStore, type ToastAction, type ToastTone } from '@/stores/toast-store'

const TONE_ICON: Record<ToastTone, string> = {
  info: 'info',
  success: 'check_circle',
  error: 'error',
}

const TONE_CLASS: Record<ToastTone, string> = {
  info: 'border-border bg-popover text-popover-foreground',
  success: 'border-primary/30 bg-primary/10 text-foreground',
  error: 'border-destructive/40 bg-destructive/10 text-foreground',
}

const TONE_ICON_CLASS: Record<ToastTone, string> = {
  info: 'text-muted-foreground',
  success: 'text-primary',
  error: 'text-destructive',
}

const AUTO_DISMISS_MS = 5000

/**
 * Global toast viewport. Renders the toasts held in the toast store (pushed via
 * the `toast`/`toastError`/`toastSuccess` helpers in `app-log-commands.ts`) and
 * auto-dismisses each after a short delay.
 */
export function Toaster(): React.JSX.Element {
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
      role="region"
      aria-label="Notifications"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            tone={toast.tone}
            title={toast.title}
            description={toast.description}
            persistent={toast.persistent}
            action={toast.action}
            onDismiss={() => dismiss(toast.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}

interface ToastItemProps {
  tone: ToastTone
  title: string
  description?: string
  persistent?: boolean
  action?: ToastAction
  onDismiss: () => void
}

function ToastItem({
  tone,
  title,
  description,
  persistent,
  action,
  onDismiss,
}: ToastItemProps): React.JSX.Element {
  React.useEffect(() => {
    if (persistent) {
      return
    }
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [onDismiss, persistent])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.18 }}
      role="status"
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-lg border p-4 shadow-lg backdrop-blur-md',
        TONE_CLASS[tone]
      )}
    >
      <Icon name={TONE_ICON[tone]} className={cn('mt-0.5 text-[20px]', TONE_ICON_CLASS[tone])} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        {action ? (
          <Button type="button" size="sm" className="mt-3" onClick={action.onClick}>
            {action.label}
          </Button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
        className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
      >
        <Icon name="close" className="text-[18px]" />
      </button>
    </motion.div>
  )
}
