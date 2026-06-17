import { useTheme } from '@/components/theme/theme-context'
import { ACCENTS, type AccentKey, type ThemePreference } from '@/stores/ui-store'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

import { SettingsSection } from './settings-section'

const THEME_OPTIONS: { value: ThemePreference; icon: string; label: string }[] = [
  { value: 'system', icon: 'desktop_windows', label: 'System Default' },
  { value: 'dark', icon: 'dark_mode', label: 'Dark Mode' },
  { value: 'light', icon: 'light_mode', label: 'Light Mode' },
]

const ACCENT_ORDER: AccentKey[] = ['default', 'violet', 'emerald', 'amber', 'rose', 'sky']

/**
 * Appearance settings: theme card picker + accent swatches. Bound to the
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
        <div>
          <h3 className="mb-4 text-base font-semibold text-foreground">Application Theme</h3>
          <div
            role="radiogroup"
            aria-label="Theme"
            className="grid grid-cols-2 gap-4 md:grid-cols-3"
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
                    'flex cursor-pointer flex-col items-center gap-4 rounded-lg border p-4 transition-colors',
                    active ? 'border-primary bg-primary/10' : 'border-border hover:bg-surface-high'
                  )}
                >
                  <Icon
                    name={option.icon}
                    className={cn('text-[32px]', active ? 'text-primary' : 'text-muted-foreground')}
                  />
                  <span className="text-sm font-medium text-foreground">{option.label}</span>
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
                    'flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border transition-transform hover:scale-110',
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
