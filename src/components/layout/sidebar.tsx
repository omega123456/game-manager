import { NavLink } from 'react-router-dom'

import { NAV_ITEMS } from '@/components/layout/nav-items'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

/**
 * Left navigation rail (256px). Brand at top, the four canonical destinations,
 * and a persistent Launch Game button at the bottom (resumes last-played —
 * placeholder until Phase E3).
 */
export function Sidebar(): React.JSX.Element {
  return (
    <aside
      data-testid="sidebar"
      className="flex h-full w-64 flex-col border-r border-border bg-surface-low"
    >
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Icon name="stadia_controller" className="text-[22px]" />
        </span>
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
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
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
          onClick={() => {
            // Placeholder — real resume-last-played behavior lands in Phase E3.
          }}
        >
          <Icon name="play_arrow" className="text-[20px]" />
          Launch Game
        </Button>
      </div>
    </aside>
  )
}
