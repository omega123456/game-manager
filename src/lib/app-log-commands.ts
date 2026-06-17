import { invoke } from '@tauri-apps/api/core'

import { useToastStore, type ToastAction, type ToastTone } from '@/stores/toast-store'

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
 * Production builds keep application logging at info+ to avoid persisting
 * verbose diagnostics in packaged installs. Development keeps trace+.
 */
export function shouldEmitFrontendLog(
  level: FrontendLogLevel,
  isDev: boolean = import.meta.env.DEV
): boolean {
  return isDev || (level !== 'debug' && level !== 'trace')
}

/**
 * Emit a line to the application logger (Rust `tracing` + `logs` table). Fire-and-forget.
 */
export function logFrontend(
  level: FrontendLogLevel,
  message: string,
  extra?: FrontendLogDetails
): void {
  if (!shouldEmitFrontendLog(level)) {
    return
  }

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

/** Options for a user-visible toast (with an optional description and log details). */
export interface ToastOptions {
  description?: string
  /** Log category recorded alongside the toast. */
  category?: string
  /** Extra log details (e.g. the underlying error string). */
  details?: string
  /**
   * Keep the toast on screen until the user dismisses it (no auto-dismiss timer).
   * Used for batch results and recoverable failures (e.g. elevation required).
   */
  persistent?: boolean
  /** Optional action button (e.g. "View details", "Relaunch as Administrator"). */
  action?: ToastAction
}

const TONE_LEVEL: Record<ToastTone, FrontendLogLevel> = {
  info: 'info',
  success: 'info',
  error: 'error',
}

/**
 * Show a user-visible toast and mirror it to the application log. This is the
 * single entrypoint for surfacing operational failures/notices to the user —
 * feature code must not call `console.*` directly.
 */
export function toast(tone: ToastTone, title: string, options?: ToastOptions): void {
  logFrontend(TONE_LEVEL[tone], title, {
    category: options?.category,
    details: options?.details ?? options?.description,
  })
  useToastStore.getState().push({
    tone,
    title,
    description: options?.description,
    persistent: options?.persistent,
    action: options?.action,
  })
}

/** Convenience: surface an error toast (logged at `error` level). */
export function toastError(title: string, options?: ToastOptions): void {
  toast('error', title, options)
}

/** Convenience: surface a success toast (logged at `info` level). */
export function toastSuccess(title: string, options?: ToastOptions): void {
  toast('success', title, options)
}
