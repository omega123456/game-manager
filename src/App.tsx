import { QueryClientProvider } from '@tanstack/react-query'
import { HashRouter } from 'react-router-dom'
import React, { useState } from 'react'

import { ThemeProvider } from '@/components/theme/theme-provider'
import { Toaster } from '@/components/ui/toaster'
import { GameRunningMotionConfig } from '@/features/launch/game-running-motion-config'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UpdateToast } from '@/features/updates/update-toast'
import { createQueryClient } from '@/lib/query-client'
import { AppRoutes } from '@/routes/app-routes'
import { useUpdateStore } from '@/stores/update-store'

/**
 * Application root: mounts the providers (TanStack Query, ThemeProvider, Tooltip,
 * Router) around the themed app shell + routes. Overlays remain Zustand state.
 */
export default function App(): React.JSX.Element {
  // One client per app instance; kept stable across renders.
  const [queryClient] = useState(createQueryClient)

  React.useEffect(() => {
    void useUpdateStore.getState().checkOnStartup()
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <GameRunningMotionConfig>
          <TooltipProvider delayDuration={200}>
            <HashRouter>
              <AppRoutes />
            </HashRouter>
            <Toaster />
            <UpdateToast />
          </TooltipProvider>
        </GameRunningMotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
