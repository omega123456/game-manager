import { Icon } from '@/components/ui/icon'

export interface SettingsSectionProps {
  /** Material Symbols glyph for the section header. */
  icon: string
  /** Section heading. */
  title: string
  /** Optional supporting copy under the heading. */
  description?: string
  children: React.ReactNode
}

/**
 * A titled settings card. Shared chrome for the API Keys, Appearance, and Global
 * Scripts sections so the page reads as a consistent sectioned layout.
 */
export function SettingsSection({
  icon,
  title,
  description,
  children,
}: SettingsSectionProps): React.JSX.Element {
  return (
    <section className="rounded-xl border border-border bg-surface-low p-6">
      <header className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon name={icon} className="text-[20px]" />
        </span>
        <div>
          <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </header>
      {children}
    </section>
  )
}
