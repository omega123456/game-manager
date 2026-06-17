import { useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LOG_PAGE_SIZE, type LogLevelFilter } from '@/lib/ipc/logs-commands'
import { useLogsQuery } from '@/lib/queries/use-logs'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { cn } from '@/lib/utils'
import type { LogEntry, LogLevel } from '@/types/domain'

/** Delay before a typed search term triggers a backend query. */
const SEARCH_DEBOUNCE_MS = 300

/** Level filter options (value -> label), `all` first. */
const LEVEL_OPTIONS: { value: LogLevelFilter; label: string }[] = [
  { value: 'all', label: 'All Levels' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warning' },
  { value: 'error', label: 'Error' },
  { value: 'debug', label: 'Debug' },
]

/** Tailwind token classes for each severity badge. */
const LEVEL_BADGE: Record<LogLevel, string> = {
  error: 'bg-destructive/15 text-destructive',
  warn: 'bg-tertiary/15 text-tertiary',
  info: 'bg-primary/10 text-primary',
  debug: 'bg-surface-highest text-muted-foreground',
}

const LEVEL_LABEL: Record<LogLevel, string> = {
  error: 'Error',
  warn: 'Warning',
  info: 'Info',
  debug: 'Debug',
}

/**
 * Format an RFC 3339 timestamp to `YYYY-MM-DD HH:mm:ss` by slicing the ISO
 * components directly (no `Date`), keeping output stable across time zones.
 */
function formatTimestamp(ts: string): string {
  if (ts.length >= 19 && ts[10] === 'T') {
    return `${ts.slice(0, 10)} ${ts.slice(11, 19)}`
  }
  return ts
}

/**
 * Build the page-number sequence for the pagination control: always the first
 * and last page, a window around the current page, and `'ellipsis'` markers for
 * any gaps. Collapses to a plain list when there are seven or fewer pages.
 */
function buildPageList(current: number, totalPages: number): (number | 'ellipsis')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const pages = new Set<number>([1, totalPages, current, current - 1, current + 1])
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b)
  const result: (number | 'ellipsis')[] = []
  let previous = 0
  for (const page of sorted) {
    if (page - previous > 1) {
      result.push('ellipsis')
    }
    result.push(page)
    previous = page
  }
  return result
}

/**
 * Log Viewer route. Lists the most recent log rows 25 per page with pagination,
 * refreshing only when the page is opened (no live polling). The backend bounds
 * the history to at least 50 pages, or a full day of logs when that is larger.
 */
export function LogsRoute(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const [level, setLevel] = useState<LogLevelFilter>('all')
  const [search, setSearch] = useState('')
  // Debounce the free-text search so a backend query fires once the user pauses
  // typing rather than on every keystroke.
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS)
  const logsQuery = useLogsQuery(page, { level, search: debouncedSearch })

  const handleLevelChange = (next: LogLevelFilter) => {
    setLevel(next)
    setPage(1)
  }
  const handleSearchChange = (next: string) => {
    setSearch(next)
    setPage(1)
  }

  const total = logsQuery.data?.total ?? 0
  const entries = logsQuery.data?.entries ?? []
  const totalPages = Math.max(1, Math.ceil(total / LOG_PAGE_SIZE))
  const rangeStart = total === 0 ? 0 : (page - 1) * LOG_PAGE_SIZE + 1
  const rangeEnd = (page - 1) * LOG_PAGE_SIZE + entries.length

  const goTo = (next: number) => setPage(Math.min(Math.max(1, next), totalPages))

  return (
    <div className="mx-auto h-full w-[min(1440px,92%)] overflow-y-auto p-8" data-testid="logs-route">
      <header className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-foreground">Logs</h1>
        <p className="text-sm text-muted-foreground">System and application event stream.</p>
      </header>

      <div className="mb-6 flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:w-48">
          <Select value={level} onValueChange={(value) => handleLevelChange(value as LogLevelFilter)}>
            <SelectTrigger aria-label="Filter logs by level" data-testid="logs-level-filter">
              <SelectValue placeholder="All Levels" />
            </SelectTrigger>
            <SelectContent>
              {LEVEL_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative w-full sm:w-96">
          <Icon
            name="search"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search logs"
            placeholder="Search logs by message or source..."
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
            className="pl-10"
            data-testid="logs-search"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-surface-low font-label text-xs uppercase tracking-wider text-muted-foreground">
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Timestamp</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Level</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Source</th>
                <th className="w-full px-4 py-3 font-semibold">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm text-foreground">
              {entries.map((entry) => (
                <LogRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>

        {entries.length === 0 ? (
          <div
            className="px-4 py-16 text-center text-sm text-muted-foreground"
            data-testid="logs-empty"
          >
            {logsQuery.isLoading
              ? 'Loading logs…'
              : level !== 'all' || debouncedSearch.trim() !== ''
                ? 'No logs match your filters.'
                : 'No logs recorded yet.'}
          </div>
        ) : null}

        <div className="flex items-center justify-between border-t border-border bg-surface-low px-4 py-3">
          <div className="text-sm text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{rangeStart}</span> to{' '}
            <span className="font-semibold text-foreground">{rangeEnd}</span> of{' '}
            <span className="font-semibold text-foreground">{total.toLocaleString()}</span> results
          </div>
          <div className="flex items-center gap-2">
            <PagerButton
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => goTo(page - 1)}
            >
              <Icon name="chevron_left" className="text-[20px]" />
            </PagerButton>
            <div className="hidden items-center gap-1 sm:flex">
              {buildPageList(page, totalPages).map((item, index) =>
                item === 'ellipsis' ? (
                  <span
                    key={`ellipsis-${index}`}
                    className="px-1 text-muted-foreground"
                    aria-hidden="true"
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    aria-label={`Page ${item}`}
                    aria-current={item === page ? 'page' : undefined}
                    onClick={() => goTo(item)}
                    className={cn(
                      'flex h-8 w-8 cursor-pointer items-center justify-center rounded-md font-label text-sm transition-colors',
                      item === page
                        ? 'bg-primary font-bold text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-surface-highest'
                    )}
                  >
                    {item}
                  </button>
                )
              )}
            </div>
            <PagerButton
              aria-label="Next page"
              disabled={page >= totalPages}
              onClick={() => goTo(page + 1)}
            >
              <Icon name="chevron_right" className="text-[20px]" />
            </PagerButton>
          </div>
        </div>
      </div>
    </div>
  )
}

function LogRow({ entry }: { entry: LogEntry }): React.JSX.Element {
  return (
    <tr className="transition-colors hover:bg-surface-low">
      <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-muted-foreground">
        {formatTimestamp(entry.ts)}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
            LEVEL_BADGE[entry.level]
          )}
        >
          {LEVEL_LABEL[entry.level]}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{entry.category}</td>
      <td className="max-w-md truncate px-4 py-3" title={entry.message}>
        {entry.message}
      </td>
    </tr>
  )
}

function PagerButton({
  disabled,
  onClick,
  children,
  'aria-label': ariaLabel,
}: {
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  'aria-label': string
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="flex cursor-pointer items-center justify-center rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-surface-highest hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}

export default LogsRoute
