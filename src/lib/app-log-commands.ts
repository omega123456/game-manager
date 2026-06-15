import { invoke } from '@tauri-apps/api/core'

/**
 * Frontend logging entrypoint (Phase A1 stub).
 *
 * This is the ONLY place in frontend code allowed to write to `console`. Feature
 * code must never call `console.*` directly — route operational and user-visible
 * failures through `logFrontend` (and the toast helpers added in later phases).
 *
 * The backend `log_frontend` command is introduced in Phase A2; until then (and
 * whenever IPC is unavailable, e.g. before the Tauri runtime is ready) the invoke
 * rejects and we fall back to a single prefixed `console` line.
 */

export type FrontendLogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace'

export interface FrontendLogDetails {
  category?: string
  details?: string
}

/**
 * Emit a line to the application logger (Rust `tracing` + `logs` table). Fire-and-forget.
 */
export function logFrontend(
  level: FrontendLogLevel,
  message: string,
  extra?: FrontendLogDetails
): void {
  void invoke('log_frontend', {
    level,
    message,
    category: extra?.category,
    details: extra?.details,
  }).catch((err: unknown) => {
    // Last-resort sink only — IPC unavailable or backend command not yet registered.
    console.error('[app-log]', level, message, err)
  })
}
