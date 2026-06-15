import { Outlet } from 'react-router-dom'

import { Sidebar } from '@/components/layout/sidebar'
import { TopBar } from '@/components/layout/top-bar'
import { LaunchBanner } from '@/features/launch/launch-banner'
import { useLaunchEvents } from '@/features/launch/use-launch-events'

/**
 * App shell: a CSS grid with a fixed 256px sidebar column and a content column
 * holding the TopBar, the live LaunchBanner slot, and the routed outlet. The
 * launch lifecycle event subscription is established here, once, at mount.
 */
export function AppLayout(): React.JSX.Element {
  useLaunchEvents()

  return (
    <div
      data-testid="app-root"
      className="grid h-screen grid-cols-[16rem_1fr] grid-rows-[auto_auto_1fr] bg-background text-foreground"
    >
      <div className="row-span-3">
        <Sidebar />
      </div>
      <TopBar />
      <LaunchBanner />
      <main className="overflow-y-auto" data-testid="route-outlet">
        <Outlet />
      </main>
    </div>
  )
}
