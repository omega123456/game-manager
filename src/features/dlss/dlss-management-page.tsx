import * as React from 'react'

import { logFrontend } from '@/lib/app-log-commands'
import {
  useDlssCatalogQuery,
  useDlssGameStatesQuery,
  useDlssSupportQuery,
  useScanDlssLibraryMutation,
} from '@/lib/queries/use-dlss'

import { GlobalOverridesCard } from './global-overrides-card'
import { GlobalIndicatorCard } from './global-indicator-card'
import { GlobalPresetsCard } from './global-presets-card'
import { DlssElevationBanner } from './dlss-elevation-banner'
import { DlssEmptyState } from './dlss-empty-state'

/** Skeleton shown while the catalog / library scan is in flight. */
function DlssPageSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-6" data-testid="dlss-loading">
      <div className="space-y-4 rounded-xl border border-border bg-surface-low p-6">
        <div className="h-5 w-48 animate-pulse rounded bg-surface-high" />
        <div className="h-10 w-full animate-pulse rounded bg-surface-high" />
        <div className="h-10 w-full animate-pulse rounded bg-surface-high" />
        <div className="h-10 w-full animate-pulse rounded bg-surface-high" />
      </div>
      <p className="text-sm text-muted-foreground">Scanning library for DLSS…</p>
    </div>
  )
}

/**
 * DLSS Management page content: header, optional elevation banner, Global
 * Overrides, and Global Presets. Triggers a scan-if-stale on mount and shows
 * loading / empty states.
 */
export function DlssManagementPage(): React.JSX.Element {
  const supportQuery = useDlssSupportQuery()
  const catalogQuery = useDlssCatalogQuery()
  const statesQuery = useDlssGameStatesQuery()
  const scanLibrary = useScanDlssLibraryMutation()

  // Re-scan the whole library every time this page is opened so games added or
  // deleted since the last scan are (re)counted — detection is session-only and
  // intentionally not relied on as a cache here. The ref guards against duplicate
  // runs within a single mount; navigating away and back remounts and re-scans.
  const scanned = React.useRef(false)
  React.useEffect(() => {
    if (scanned.current) {
      return
    }
    scanned.current = true
    logFrontend('debug', 'DLSS management opened — rescanning library', {
      category: 'dlss.scan',
    })
    scanLibrary.mutate()
  }, [scanLibrary])

  const isElevated = supportQuery.data?.isElevated ?? true
  const nvapiAvailable = supportQuery.data?.nvapiAvailable ?? false

  // Only block on the genuine first-load of the catalog/state queries. The
  // on-open library rescan runs in the background and refreshes counts in place
  // (via query invalidation) — it must not flip the whole page back to a
  // skeleton, which looks like the page is stuck while re-reading DLLs.
  const loading = catalogQuery.isLoading || statesQuery.isLoading
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
          <DlssPageSkeleton />
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
