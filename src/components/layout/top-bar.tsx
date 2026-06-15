import { useUiStore } from '@/stores/ui-store'
import { ThemeControl } from '@/components/theme/theme-control'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { usePlayNowTarget } from '@/features/launch/play-now'

/**
 * Top bar: global search (filters the library), a primary Play Now action
 * (resume last-played — placeholder until Phase E3), and the theme control.
 */
export function TopBar(): React.JSX.Element {
  const searchQuery = useUiStore((s) => s.searchQuery)
  const setSearchQuery = useUiStore((s) => s.setSearchQuery)
  const { target, disabled, launch } = usePlayNowTarget()

  return (
    <header
      data-testid="top-bar"
      className="flex h-16 items-center gap-4 border-b border-border bg-surface px-6"
    >
      <div className="relative w-full max-w-md">
        <Icon
          name="search"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Search games"
          placeholder="Search games…"
          className="pl-10"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <Button
          type="button"
          data-testid="play-now-button"
          disabled={disabled}
          aria-label={target ? `Play Now: ${target.gameName}` : 'Play Now'}
          onClick={launch}
        >
          <Icon name="play_arrow" className="text-[20px]" />
          Play Now
        </Button>
        <ThemeControl />
      </div>
    </header>
  )
}
