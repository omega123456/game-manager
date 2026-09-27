import { open } from '@tauri-apps/plugin-dialog'

/** Reduce a file-dialog result to a single path, or `null` when nothing was picked. */
export function normalizeDialogPath(value: string | string[] | null): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null
  }
  return typeof value === 'string' ? value : null
}

/** Open a single-file picker filtered to `.exe` files. Resolves to `null` on cancel. */
export async function pickExecutable(title: string): Promise<string | null> {
  const result = await open({
    directory: false,
    multiple: false,
    title,
    filters: [{ name: 'Applications', extensions: ['exe'] }],
  })
  return normalizeDialogPath(result)
}
