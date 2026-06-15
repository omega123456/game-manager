import { QueryClientProvider } from '@tanstack/react-query'
import { HashRouter } from 'react-router-dom'
import { useState } from 'react'

import { ThemeProvider } from '@/components/theme/theme-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createQueryClient } from '@/lib/query-client'
import { AppRoutes } from '@/routes/app-routes'

/**
 * Application root: mounts the providers (TanStack Query, ThemeProvider, Tooltip,
 * Router) around the themed app shell + routes. Overlays remain Zustand state.
 */
export default function App(): React.JSX.Element {
  // One client per app instance; kept stable across renders.
  const [queryClient] = useState(createQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delayDuration={200}>
          <HashRouter>
            <AppRoutes />
          </HashRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
