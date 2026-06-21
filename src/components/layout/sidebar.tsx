import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

import appIcon from '@/assets/app-icon.png'
import { NAV_ITEMS } from '@/components/layout/nav-items'
import { Icon } from '@/components/ui/icon'
import { launchGameById } from '@/features/launch/launch-controller'
import { toCoverImageUrl } from '@/lib/asset-url'
import { usePlayNowGameQuery } from '@/lib/queries/use-games'
import { cn } from '@/lib/utils'
import { useLaunchStore } from '@/stores/launch-store'

/**
 * Left navigation rail (256px). Brand at top, the four canonical destinations,
 * and a persistent "continue playing" mini game card at the bottom that resumes
 * the last-played game.
 */
export function Sidebar(): React.JSX.Element {
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

      <nav className="flex flex-1 flex-col gap-2 px-4 py-2" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'group flex cursor-pointer items-center gap-4 rounded-lg px-4 py-2 font-label text-sm transition-colors duration-150',
                isActive
                  ? 'border-r-2 border-primary bg-surface-highest/30 font-bold text-primary'
                  : 'font-medium text-muted-foreground hover:bg-surface-highest hover:text-foreground'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  name={item.icon}
                  filled={isActive}
                  className={cn(
                    'text-2xl transition-colors',
                    !isActive && 'group-hover:text-primary'
                  )}
                />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <SidebarLaunchCard />
    </aside>
  )
}

/**
 * Mini "continue playing" card pinned to the bottom of the rail. Mirrors the
 * library hero: the last-played game's cover backs a horizontal pill carrying
 * the title and a compact play control. Clicking navigates to the library
 * before kicking off the launch. Renders nothing when there is no game to
 * continue (same hide logic as the hero).
 */
function SidebarLaunchCard(): React.JSX.Element | null {
  const navigate = useNavigate()
  const playNowQuery = usePlayNowGameQuery()
  const isLaunchActive = useLaunchStore((state) => state.isActive())
  const game = playNowQuery.data ?? null

  const coverUrl = toCoverImageUrl(game?.imagePath)
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null)
  const coverFailed = coverUrl !== null && failedCoverUrl === coverUrl
  const showCover = coverUrl !== null && !coverFailed

  if (game === null) {
    return null
  }

  const handleLaunch = () => {
    if (isLaunchActive) {
      return
    }
    navigate('/library')
    launchGameById(game.id, game.name)
  }

  return (
    <div className="border-t border-border p-3">
      <button
        type="button"
        data-testid="launch-game-button"
        disabled={isLaunchActive}
        aria-label={`Launch Game: ${game.name}`}
        onClick={handleLaunch}
        className="group relative flex min-h-20 w-full cursor-pointer items-center gap-3 overflow-hidden rounded-2xl border border-border bg-surface-container p-3 text-left transition-transform hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-60"
      >
        {showCover ? (
          <img
            src={coverUrl}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => {
              if (coverUrl) {
                setFailedCoverUrl(coverUrl)
              }
            }}
          />
        ) : (
          <div
            className="absolute inset-0 bg-linear-to-br from-primary/20 via-transparent to-secondary/15"
            data-testid="launch-card-cover-fallback"
          />
        )}
        <div className="absolute inset-0 bg-linear-to-r from-background/95 via-background/75 to-background/40" />

        <span className="relative z-10 min-w-0 flex-1 pl-1">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Continue Playing
          </span>
          <span className="mt-0.5 block truncate font-heading text-base font-bold text-foreground">
            {game.name}
          </span>
        </span>
        <span className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
          <Icon name="play_arrow" className="text-[24px]" />
        </span>
      </button>
    </div>
  )
}
