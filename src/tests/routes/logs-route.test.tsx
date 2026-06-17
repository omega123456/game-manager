import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { LogsRoute } from '@/routes/logs-route'
import type { LogEntry } from '@/types/domain'
import { ipc } from '../ipc-mock'
import { renderWithProviders, resetUiStore } from '../helpers/render-app'

/** Build `count` deterministic log rows for a page (newest first). */
function makeEntries(count: number, startId: number): LogEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: startId - i,
    ts: '2026-06-17T14:32:01.000Z',
    level: 'info' as const,
    category: 'test',
    message: `message ${startId - i}`,
  }))
}

/** Override `list_logs` to page over a fixed total with the given page size. */
function overrideLogs(total: number, pageSize = 25): void {
  ipc.override('list_logs', (args) => {
    const page = Number(args?.page ?? 1)
    const start = (page - 1) * pageSize
    const count = Math.max(0, Math.min(pageSize, total - start))
    return {
      entries: makeEntries(count, total - start),
      total,
      page,
      pageSize,
    }
  })
}

describe('LogsRoute', () => {
  beforeEach(() => {
    resetUiStore()
  })

  it('renders the header and a page of log rows', async () => {
    overrideLogs(60)
    renderWithProviders(<LogsRoute />, { route: '/logs' })

    expect(screen.getByRole('heading', { name: 'Logs', level: 1 })).toBeInTheDocument()
    // First page shows 25 rows.
    const rows = await screen.findAllByText(/^message \d+$/)
    expect(rows).toHaveLength(25)
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1 to 25 of 60 results')
  })

  it('advances to the next page when Next is clicked', async () => {
    overrideLogs(60)
    const user = userEvent.setup()
    renderWithProviders(<LogsRoute />, { route: '/logs' })

    await screen.findByText('message 60')
    await user.click(screen.getByRole('button', { name: 'Next page' }))

    // Page 2 starts at id 35 (total 60, rows 26..50).
    await screen.findByText('message 35')
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 26 to 50 of 60 results')
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page')
  })

  it('jumps to the last page via a numbered button and disables Next there', async () => {
    overrideLogs(60)
    const user = userEvent.setup()
    renderWithProviders(<LogsRoute />, { route: '/logs' })

    await screen.findByText('message 60')
    await user.click(screen.getByRole('button', { name: 'Page 3' }))

    // Last page holds the final 10 rows (ids 10..1).
    await screen.findByText('message 10')
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 51 to 60 of 60 results')
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })

  it('disables Previous on the first page', async () => {
    overrideLogs(60)
    renderWithProviders(<LogsRoute />, { route: '/logs' })

    await screen.findByText('message 60')
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
  })

  it('shows an empty state when there are no logs', async () => {
    overrideLogs(0)
    renderWithProviders(<LogsRoute />, { route: '/logs' })

    expect(await screen.findByText('No logs recorded yet.')).toBeInTheDocument()
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 0 to 0 of 0 results')
  })

  it('passes the selected level filter to the backend and resets to page 1', async () => {
    const calls: Array<Record<string, unknown> | undefined> = []
    ipc.override('list_logs', (args) => {
      calls.push(args)
      const level = args?.level
      const total = level === 'error' ? 5 : 60
      const page = Number(args?.page ?? 1)
      const start = (page - 1) * 25
      const count = Math.max(0, Math.min(25, total - start))
      return { entries: makeEntries(count, total - start), total, page, pageSize: 25 }
    })
    const user = userEvent.setup()
    renderWithProviders(<LogsRoute />, { route: '/logs' })

    await screen.findByText('message 60')
    // Move off page 1 first to prove the filter resets pagination.
    await user.click(screen.getByRole('button', { name: 'Page 2' }))
    await screen.findByText('message 35')

    await user.click(screen.getByRole('combobox', { name: 'Filter logs by level' }))
    await user.click(screen.getByRole('option', { name: 'Error' }))

    await screen.findByText('message 5')
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1 to 5 of 5 results')
    const last = calls[calls.length - 1]
    expect(last?.level).toBe('error')
    expect(last?.page).toBe(1)
  })

  it('passes the search term to the backend', async () => {
    const calls: Array<Record<string, unknown> | undefined> = []
    ipc.override('list_logs', (args) => {
      calls.push(args)
      const total = args?.search === 'steam' ? 2 : 60
      return { entries: makeEntries(Math.min(25, total), total), total, page: 1, pageSize: 25 }
    })
    const user = userEvent.setup()
    renderWithProviders(<LogsRoute />, { route: '/logs' })

    await screen.findByText('message 60')
    await user.type(screen.getByRole('searchbox', { name: 'Search logs' }), 'steam')

    // Filtered result has 2 rows (ids 2, 1).
    await screen.findByText('message 2')
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1 to 2 of 2 results')
    expect(calls[calls.length - 1]?.search).toBe('steam')
  })

  it('shows a filter-aware empty state when filters match nothing', async () => {
    ipc.override('list_logs', (args) => ({
      entries: [],
      total: 0,
      page: Number(args?.page ?? 1),
      pageSize: 25,
    }))
    const user = userEvent.setup()
    renderWithProviders(<LogsRoute />, { route: '/logs' })

    await screen.findByText('No logs recorded yet.')
    await user.type(screen.getByRole('searchbox', { name: 'Search logs' }), 'zzz')
    expect(await screen.findByText('No logs match your filters.')).toBeInTheDocument()
  })

  it('renders a badge for each severity level', async () => {
    ipc.override('list_logs', () => ({
      entries: [
        { id: 4, ts: '2026-06-17T14:32:04.000Z', level: 'error', category: 'a', message: 'e' },
        { id: 3, ts: '2026-06-17T14:32:03.000Z', level: 'warn', category: 'b', message: 'w' },
        { id: 2, ts: '2026-06-17T14:32:02.000Z', level: 'info', category: 'c', message: 'i' },
        { id: 1, ts: '2026-06-17T14:32:01.000Z', level: 'debug', category: 'd', message: 'd' },
      ],
      total: 4,
      page: 1,
      pageSize: 25,
    }))
    renderWithProviders(<LogsRoute />, { route: '/logs' })

    const table = await screen.findByRole('table')
    await within(table).findByText('Error')
    expect(within(table).getByText('Error')).toBeInTheDocument()
    expect(within(table).getByText('Warning')).toBeInTheDocument()
    expect(within(table).getByText('Info')).toBeInTheDocument()
    expect(within(table).getByText('Debug')).toBeInTheDocument()
    // RFC 3339 timestamp is rendered as `YYYY-MM-DD HH:mm:ss`.
    expect(within(table).getAllByText('2026-06-17 14:32:01')[0]).toBeInTheDocument()
  })
})
