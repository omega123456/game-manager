import type * as React from 'react'

import {
  useDlssCatalogQuery,
  useDlssGameStatesQuery,
  useDlssScanStatusQuery,
  useDlssSupportQuery,
  useScanDlssLibraryMutation,
} from '@/lib/queries/use-dlss'

import { GlobalOverridesCard } from './global-overrides-card'
import { GlobalIndicatorCard } from './global-indicator-card'
import { GlobalPresetsCard } from './global-presets-card'
import { DlssElevationBanner } from './dlss-elevation-banner'
import { DlssEmptyState } from './dlss-empty-state'

/** Skeleton shown while the catalog / library scan is in flight. */
function DlssPageSkeleton({
  message = 'Scanning library for DLSS…',
}: {
  message?: string
}): React.JSX.Element {
  return (
    <div className="space-y-6" data-testid="dlss-loading">
      <div className="space-y-4 rounded-xl border border-border bg-surface-low p-6">
        <div className="h-5 w-48 animate-pulse rounded bg-surface-high" />
        <div className="h-10 w-full animate-pulse rounded bg-surface-high" />
        <div className="h-10 w-full animate-pulse rounded bg-surface-high" />
        <div className="h-10 w-full animate-pulse rounded bg-surface-high" />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

/**
 * DLSS Management page content: header, optional elevation banner, Global
 * Overrides, and Global Presets. Reuses the startup scan cache and waits for it
 * to finish if still in progress.
 */
export function DlssManagementPage(): React.JSX.Element {
  const supportQuery = useDlssSupportQuery()
  const scanStatusQuery = useDlssScanStatusQuery()
  const catalogQuery = useDlssCatalogQuery()
  const statesQuery = useDlssGameStatesQuery()
  const scanLibrary = useScanDlssLibraryMutation()

  const isElevated = supportQuery.data?.isElevated ?? true
  const nvapiAvailable = supportQuery.data?.nvapiAvailable ?? false
  const scanning = scanStatusQuery.data?.scanning ?? false
  const waitingForScan = scanStatusQuery.isLoading || scanning
  const loading = catalogQuery.isLoading || statesQuery.isLoading || waitingForScan
  const states = statesQuery.data ?? []
  const hasGames = states.some(
    (state) => state.superResolution || state.frameGeneration || state.rayReconstruction
  )

  return (
    <div className="mx-auto h-full w-[min(1100px,70%)] overflow-y-auto p-8">
      <header className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-foreground">DLSS Management</h1>
        <p className="text-sm text-muted-foreground">
          Force DLL versions across games and set NVIDIA presets.
        </p>
      </header>

      <div className="space-y-6">
        {!isElevated ? <DlssElevationBanner /> : null}

        {loading ? (
          <DlssPageSkeleton
            message={waitingForScan ? 'Waiting for DLSS scan to finish…' : undefined}
          />
        ) : (
          <>
            {catalogQuery.data ? <GlobalOverridesCard catalog={catalogQuery.data} /> : null}
            {!hasGames ? (
              <DlssEmptyState
                onRescan={() => scanLibrary.mutate()}
                scanning={scanLibrary.isPending}
              />
            ) : null}
            <GlobalPresetsCard supported={nvapiAvailable} />
            <GlobalIndicatorCard />
          </>
        )}
      </div>
    </div>
  )
}
