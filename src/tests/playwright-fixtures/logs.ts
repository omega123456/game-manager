/**
 * Playwright fixtures for the logs domain.
 *
 * The web build (VITE_PLAYWRIGHT) has no Tauri backend, so `list_logs` resolves
 * to a deterministic, paginated set of rows. Data lives here (not in the mock
 * router) so the Log Viewer screenshots stay stable across runs.
 */
import type { PlaywrightFixtureHandler } from './index'

interface LogRowFixture {
  id: number
  ts: string
  level: 'error' | 'warn' | 'info' | 'debug'
  category: string
  message: string
}

const LEVELS = ['info', 'warn', 'info', 'error', 'debug', 'info'] as const
const SOURCES = ['System', 'Launcher', 'Steam Script', 'AssetLoader', 'Frontend']
const MESSAGES = [
  'User authentication successful. Token issued.',
  'High memory usage detected (85%) during asset pre-caching.',
  'Initiating user login sequence...',
  'Failed to initialize Steamworks API context. Check library paths.',
  'Loading texture pack: env_forest_hd.pak (1.2GB)',
  'Session ended; cleanup scripts completed.',
]

/** Deterministic fixed set of 60 log rows (newest first), spanning three pages. */
export const LOGS_ROWS: LogRowFixture[] = Array.from({ length: 60 }, (_, i) => {
  const second = String(59 - (i % 60)).padStart(2, '0')
  const minute = String(32 - Math.floor(i / 12)).padStart(2, '0')
  return {
    id: 1000 - i,
    ts: `2026-06-17T14:${minute}:${second}.000Z`,
    level: LEVELS[i % LEVELS.length],
    category: SOURCES[i % SOURCES.length],
    message: MESSAGES[i % MESSAGES.length],
  }
})

export const logsFixtures: Record<string, PlaywrightFixtureHandler> = {
  list_logs: (args) => {
    const page = Math.max(1, Number(args?.page ?? 1))
    const pageSize = Math.max(1, Number(args?.pageSize ?? 25))
    const level = typeof args?.level === 'string' ? args.level : undefined
    const search = typeof args?.search === 'string' ? args.search.trim().toLowerCase() : ''

    const matched = LOGS_ROWS.filter((row) => {
      if (level && row.level !== level) {
        return false
      }
      if (
        search &&
        !row.message.toLowerCase().includes(search) &&
        !row.category.toLowerCase().includes(search)
      ) {
        return false
      }
      return true
    })

    const start = (page - 1) * pageSize
    return {
      entries: matched.slice(start, start + pageSize),
      total: matched.length,
      page,
      pageSize,
    }
  },
}
