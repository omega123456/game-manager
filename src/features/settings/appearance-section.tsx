import { useTheme } from '@/components/theme/theme-context'
import { ACCENTS, type AccentKey, type ThemePreference } from '@/stores/ui-store'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

import { SettingsSection } from './settings-section'

const THEME_OPTIONS: { value: ThemePreference; icon: string; label: string }[] = [
  { value: 'system', icon: 'computer', label: 'System' },
  { value: 'dark', icon: 'dark_mode', label: 'Dark' },
  { value: 'light', icon: 'light_mode', label: 'Light' },
]

const ACCENT_ORDER: AccentKey[] = ['default', 'violet', 'emerald', 'amber', 'rose', 'sky']

/**
 * Appearance settings: theme segmented control + accent swatches. Bound to the
 * shared `ThemeProvider` via `useTheme`, so changes apply app-wide immediately
 * (and persist via the provider's fire-and-forget `set_setting` + localStorage).
 */
export function AppearanceSection(): React.JSX.Element {
  const { theme, accent, setTheme, setAccent } = useTheme()

  return (
    <SettingsSection
      icon="palette"
      title="Appearance"
      description="Theme and accent color for the app."
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <span className="text-sm font-medium text-foreground">Theme</span>
          <div
            role="radiogroup"
            aria-label="Theme"
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-lowest p-1"
          >
            {THEME_OPTIONS.map((option) => {
              const active = theme === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`${option.label} theme`}
                  onClick={() => setTheme(option.value)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon name={option.icon} className="text-[18px]" />
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium text-foreground">Accent</span>
          <div
            role="radiogroup"
            aria-label="Accent color"
            className="flex items-center gap-2"
            data-testid="settings-accent-swatches"
          >
            {ACCENT_ORDER.map((key) => {
              const { label, hsl } = ACCENTS[key]
              const active = accent === key
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`${label} accent`}
                  title={label}
                  onClick={() => setAccent(key)}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full border transition-transform hover:scale-110',
                    active
                      ? 'border-foreground ring-2 ring-ring ring-offset-2 ring-offset-background'
                      : 'border-border'
                  )}
                  style={{
                    backgroundColor: hsl ? `hsl(${hsl})` : 'hsl(var(--primary-default))',
                  }}
                >
                  {active ? (
                    <Icon name="check" className="text-[16px] text-primary-foreground" />
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </SettingsSection>
  )
}
