import { invoke } from '@tauri-apps/api/core'

import type { LogLevel, LogPage } from '@/types/domain'

/** Rows shown per page in the Log Viewer (mirrors the backend `LOG_PAGE_SIZE`). */
export const LOG_PAGE_SIZE = 25

/** The level filter value, including the `'all'` (no filter) sentinel. */
export type LogLevelFilter = LogLevel | 'all'

/** Active Log Viewer filters. */
export interface LogFilters {
  /** Exact severity level, or `'all'` for no level filter. */
  level: LogLevelFilter
  /** Free-text term matched against the message or category. */
  search: string
}

/**
 * Read a single page of log rows (newest first). `page` is 1-based. Optional
 * `filters` narrow the results by severity level and/or a free-text term. The
 * backend bounds pagination to at least 50 pages, or a full day of logs when
 * larger, and reports that bounded count as {@link LogPage.total}.
 */
export function listLogs(
  page: number,
  filters?: LogFilters,
  pageSize: number = LOG_PAGE_SIZE
): Promise<LogPage> {
  const level = filters && filters.level !== 'all' ? filters.level : undefined
  const search = filters?.search.trim() ? filters.search.trim() : undefined
  return invoke<LogPage>('list_logs', { page, pageSize, level, search })
}
