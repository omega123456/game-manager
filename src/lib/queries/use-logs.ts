import { useQuery } from '@tanstack/react-query'

import { listLogs, LOG_PAGE_SIZE, type LogFilters } from '@/lib/ipc/logs-commands'
import type { LogPage } from '@/types/domain'

/** Query key for a single page of logs. */
export const LOGS_QUERY_KEY = ['logs'] as const

/**
 * Load one page of logs (1-based) under the active filters. The Log Viewer
 * refreshes on open only — there is no polling — so page data is treated as
 * immediately stale and refetched whenever the route mounts, the page changes,
 * or a filter changes.
 */
export function useLogsQuery(page: number, filters: LogFilters) {
  return useQuery({
    queryKey: [...LOGS_QUERY_KEY, page, filters.level, filters.search.trim()],
    queryFn: (): Promise<LogPage> => listLogs(page, filters, LOG_PAGE_SIZE),
    staleTime: 0,
    refetchOnMount: 'always',
  })
}
