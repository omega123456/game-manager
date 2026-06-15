import { convertFileSrc } from '@tauri-apps/api/core'

// Values already carrying a URL scheme are safe to render directly; only raw
// filesystem paths need conversion into a webview-servable asset URL. The scheme
// must be 2+ chars so Windows drive letters (e.g. `C:/...`) are treated as paths.
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]+:/i

/**
 * Normalize a stored cover-image reference into a webview-safe URL.
 *
 * Remote candidate URLs (http/https/data/blob) and already-converted asset URLs
 * pass through untouched; local filesystem paths are run through Tauri's
 * `convertFileSrc` so the webview can load them under the asset protocol.
 */
export function toCoverImageUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  if (URL_SCHEME_PATTERN.test(trimmed)) {
    return trimmed
  }
  return convertFileSrc(trimmed)
}
