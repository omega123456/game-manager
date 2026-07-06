import { useRef } from 'react'
import { Outlet } from 'react-router-dom'

import { Sidebar } from '@/components/layout/sidebar'
import { ScrollContainerProvider } from '@/components/layout/scroll-container-context'
import { TopBar } from '@/components/layout/top-bar'
import { AppCloseGuard } from '@/features/launch/app-close-guard'
import { LaunchBanner } from '@/features/launch/launch-banner'
import { useLaunchEvents } from '@/features/launch/use-launch-events'
import { useDlssLibraryScanSync } from '@/lib/queries/use-dlss'

/**
 * App shell: a CSS grid with a fixed 256px sidebar column and a content column
 * holding the TopBar, the live LaunchBanner slot, and the routed outlet. The
 * launch lifecycle and DLSS library-scan event subscriptions are established
 * here, once, at mount.
 */
export function AppLayout(): React.JSX.Element {
  useLaunchEvents()
  useDlssLibraryScanSync()

  const mainRef = useRef<HTMLElement | null>(null)

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
      <main ref={mainRef} className="overflow-y-auto" data-testid="route-outlet">
        <ScrollContainerProvider scrollRef={mainRef}>
          <Outlet />
        </ScrollContainerProvider>
      </main>
      <AppCloseGuard />
    </div>
  )
}
