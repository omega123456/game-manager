import { useTheme } from '@/components/theme/theme-context'
import { ACCENTS, type AccentKey, type ThemePreference } from '@/stores/ui-store'
import { Icon } from '@/components/ui/icon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const THEME_OPTIONS: { value: ThemePreference; icon: string; label: string }[] = [
  { value: 'system', icon: 'computer', label: 'System theme' },
  { value: 'light', icon: 'light_mode', label: 'Light theme' },
  { value: 'dark', icon: 'dark_mode', label: 'Dark theme' },
]

const ACCENT_ORDER: AccentKey[] = ['default', 'violet', 'emerald', 'amber', 'rose', 'sky']

/**
 * TopBar theme control: a small theme segmented switch plus accent swatches.
 * Bound to ThemeProvider via `useTheme`; A4's Appearance section reuses the same
 * hook for full-page controls.
 */
export function ThemeControl(): React.JSX.Element {
  const { theme, accent, setTheme, setAccent } = useTheme()

  return (
    <div className="flex items-center gap-2" data-testid="theme-control">
      <div
        role="radiogroup"
        aria-label="Theme"
        className="flex items-center rounded-lg border border-border bg-surface-low p-0.5"
      >
        {THEME_OPTIONS.map((option) => {
          const active = theme === option.value
          return (
            <Tooltip key={option.value}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={option.label}
                  onClick={() => setTheme(option.value)}
                  className={cn(
                    'flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors',
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon name={option.icon} className="text-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{option.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      <div
        role="radiogroup"
        aria-label="Accent color"
        className="flex items-center gap-1"
        data-testid="accent-swatches"
      >
        {ACCENT_ORDER.map((key) => {
          const { label, hsl } = ACCENTS[key]
          const active = accent === key
          return (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`${label} accent`}
                  onClick={() => setAccent(key)}
                  className={cn(
                    'h-5 w-5 cursor-pointer rounded-full border transition-transform hover:scale-110',
                    active
                      ? 'border-foreground ring-2 ring-ring ring-offset-1 ring-offset-background'
                      : 'border-border'
                  )}
                  style={{
                    backgroundColor: hsl ? `hsl(${hsl})` : 'hsl(var(--primary-default))',
                  }}
                >
                  {active ? (
                    <Icon name="check" className="text-[14px] text-primary-foreground" />
                  ) : null}
                </button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}

export default ThemeControl
