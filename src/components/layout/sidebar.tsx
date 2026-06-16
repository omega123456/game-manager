import { NavLink } from 'react-router-dom'

import appIcon from '@/assets/app-icon.png'
import { NAV_ITEMS } from '@/components/layout/nav-items'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { usePlayNowTarget } from '@/features/launch/play-now'
import { cn } from '@/lib/utils'

/**
 * Left navigation rail (256px). Brand at top, the four canonical destinations,
 * and a persistent Launch Game button at the bottom (resumes last-played —
 * placeholder until Phase E3).
 */
export function Sidebar(): React.JSX.Element {
  const { target, disabled, launch } = usePlayNowTarget()

  return (
    <aside
      data-testid="sidebar"
      className="flex h-full w-64 flex-col border-r border-border bg-surface-low"
    >
      <div className="flex items-center gap-2 px-5 py-5">
        <img src={appIcon} alt="" aria-hidden="true" className="h-9 w-9 rounded-lg" />
        <span className="font-heading text-lg font-bold tracking-tight text-foreground">
          Game Manager
        </span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-surface-high hover:text-foreground'
              )
            }
          >
            <Icon name={item.icon} className="text-[20px]" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <Button
          type="button"
          className="w-full"
          data-testid="launch-game-button"
          disabled={disabled}
          aria-label={target ? `Launch Game: ${target.gameName}` : 'Launch Game'}
          onClick={launch}
        >
          <Icon name="play_arrow" className="text-[20px]" />
          Launch Game
        </Button>
      </div>
    </aside>
  )
}
