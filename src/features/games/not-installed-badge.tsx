import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

export interface NotInstalledBadgeProps {
  className?: string
}

/** Neutral status pill marking a game whose launch target is missing. */
export function NotInstalledBadge({ className }: NotInstalledBadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-border bg-background/80 px-2 py-1 text-[11px] font-semibold text-foreground backdrop-blur',
        className
      )}
      data-testid="not-installed-badge"
    >
      <Icon name="link_off" className="text-[14px]" />
      Not installed
    </span>
  )
}
