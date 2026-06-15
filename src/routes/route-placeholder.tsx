import { Icon } from '@/components/ui/icon'

export interface RoutePlaceholderProps {
  title: string
  description: string
  icon: string
}

/**
 * Shared placeholder shell for a sidebar destination. Real page content is filled
 * in by later phases (B2 library, C2 scripts, D2 groups, A4 settings).
 */
export function RoutePlaceholder({
  title,
  description,
  icon,
}: RoutePlaceholderProps): React.JSX.Element {
  return (
    <section className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
      <Icon name={icon} className="text-[64px] text-primary" />
      <h1 className="font-heading text-2xl font-bold text-foreground">{title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
    </section>
  )
}
