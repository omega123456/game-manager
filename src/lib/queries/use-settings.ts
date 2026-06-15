import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getAllSettings, setSetting, type Setting } from '@/lib/ipc/settings-commands'

/** Query key for the full settings map. */
export const SETTINGS_QUERY_KEY = ['settings'] as const

/**
 * Load every persisted setting as a `key -> value` record. Keys with a null
 * value resolve to an empty string for ergonomic form binding.
 */
export function useSettingsQuery() {
  return useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: async (): Promise<Record<string, string>> => {
      const rows: Setting[] = await getAllSettings()
      return Object.fromEntries(rows.map((row) => [row.key, row.value ?? '']))
    },
  })
}

/**
 * Persist a single setting and invalidate the settings cache on success so any
 * consumer (API key inputs, hydration) re-reads the authoritative value.
 */
export function useSetSettingMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => setSetting(key, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY })
    },
  })
}
