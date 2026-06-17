import type { ComboboxOption } from '@/components/ui/combobox'
import type { DllVersion } from '@/types/dlss'

/** Sentinel value used by the version comboboxes for "System Default". */
export const SYSTEM_DEFAULT_VALUE = '__system_default__'

/** Group headings used in the version combobox. */
export const VERSION_GROUPS = {
  systemDefault: 'System Default',
  downloaded: 'Downloaded',
  available: 'Available',
} as const

/** Format a byte count as an approximate, human-friendly size (e.g. `~45 MB`). */
export function formatApproxSize(bytes: number): string {
  if (bytes <= 0) {
    return ''
  }
  const mb = bytes / (1024 * 1024)
  if (mb < 1) {
    const kb = bytes / 1024
    return `~${Math.round(kb)} KB`
  }
  return `~${Math.round(mb)} MB`
}

/**
 * Build the grouped combobox options for a list of catalog versions: a leading
 * "System Default" entry, then downloaded versions, then available (not yet
 * downloaded) versions. Available entries carry their approximate zip size.
 */
export function buildVersionOptions(versions: DllVersion[]): ComboboxOption[] {
  const options: ComboboxOption[] = [
    {
      value: SYSTEM_DEFAULT_VALUE,
      label: 'System Default',
      group: VERSION_GROUPS.systemDefault,
    },
  ]

  for (const version of versions) {
    if (version.isDownloaded) {
      options.push({
        value: version.version,
        label: version.label,
        group: VERSION_GROUPS.downloaded,
      })
    }
  }

  for (const version of versions) {
    if (!version.isDownloaded) {
      options.push({
        value: version.version,
        label: version.label,
        group: VERSION_GROUPS.available,
      })
    }
  }

  return options
}

/** Find a catalog version by its display version string. */
export function findVersion(versions: DllVersion[], version: string): DllVersion | undefined {
  return versions.find((entry) => entry.version === version)
}
