import type { ReactElement, ReactNode } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

import { ThemeProvider } from '@/components/theme/theme-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createQueryClient } from '@/lib/query-client'
import { useUiStore } from '@/stores/ui-store'

/** Reset the global UI store to its defaults between tests. */
export function resetUiStore(): void {
  useUiStore.setState({
    theme: 'system',
    accent: 'default',
    activeOverlay: 'none',
    searchQuery: '',
  })
}

export interface RenderWithProvidersOptions {
  /** Initial router entries (default `['/library']`). */
  route?: string
  /** Wrap in ThemeProvider (default true). */
  withTheme?: boolean
}

/** Render a UI tree with the app's providers and a MemoryRouter. */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/library', withTheme = true }: RenderWithProvidersOptions = {}
): RenderResult {
  const client = createQueryClient()
  const Wrapped = (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
  const tree: ReactNode = withTheme ? <ThemeProvider>{Wrapped}</ThemeProvider> : Wrapped
  return render(tree)
}
