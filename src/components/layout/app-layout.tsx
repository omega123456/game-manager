import { Outlet } from 'react-router-dom'

import { Sidebar } from '@/components/layout/sidebar'
import { TopBar } from '@/components/layout/top-bar'

/**
 * App shell: a CSS grid with a fixed 256px sidebar column and a content column
 * holding the TopBar plus the routed outlet. A fixed slot under the TopBar
 * (the LaunchBanner) is added in Phase E2.
 */
export function AppLayout(): React.JSX.Element {
  return (
    <div
      data-testid="app-root"
      className="grid h-screen grid-cols-[16rem_1fr] grid-rows-[auto_1fr] bg-background text-foreground"
    >
      <div className="row-span-2">
        <Sidebar />
      </div>
      <TopBar />
      <main className="overflow-y-auto" data-testid="route-outlet">
        <Outlet />
      </main>
    </div>
  )
}
