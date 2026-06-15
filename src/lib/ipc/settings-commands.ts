import { invoke } from '@tauri-apps/api/core'

import { logFrontend } from '@/lib/app-log-commands'

/** A single key/value entry from the backend `settings` table. */
export interface Setting {
  key: string
  /** Value, or `null`/`undefined` when the row exists with a null value. */
  value?: string | null
}

/**
 * Persist a single setting. Fire-and-forget: theme/accent changes call this so an
 * IPC error never blocks the UI change (they also persist to a local fallback via
 * theme-storage so reload restores them regardless). For awaited persistence with
 * surfaced errors (e.g. the Settings page Save Keys button), use {@link setSetting}.
 */
export function setSettingFireAndForget(key: string, value: string): void {
  void invoke('set_setting', { key, value }).catch((err: unknown) => {
    logFrontend('debug', 'set_setting fire-and-forget failed', {
      category: 'settings',
      details: `${key}: ${String(err)}`,
    })
  })
}

/** Read every setting as a list of key/value pairs (ordered by key). */
export function getAllSettings(): Promise<Setting[]> {
  return invoke<Setting[]>('get_all_settings')
}

/** Read a single setting value, or `null` when unset. */
export function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>('get_setting', { key })
}

/** Upsert a single setting value. Rejects on backend failure (awaited path). */
export function setSetting(key: string, value: string): Promise<void> {
  return invoke<void>('set_setting', { key, value })
}
