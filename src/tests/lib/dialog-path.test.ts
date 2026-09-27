import { describe, expect, it } from 'vitest'

import { normalizeDialogPath, pickExecutable } from '@/lib/dialog-path'
import { ipc } from '@/tests/ipc-mock'

describe('dialog-path', () => {
  it('normalizes single, multi and empty dialog results', () => {
    expect(normalizeDialogPath('C:/a.exe')).toBe('C:/a.exe')
    expect(normalizeDialogPath(['C:/a.exe', 'C:/b.exe'])).toBe('C:/a.exe')
    expect(normalizeDialogPath([])).toBeNull()
    expect(normalizeDialogPath(null)).toBeNull()
  })

  it('opens an exe-filtered picker and returns the chosen path', async () => {
    ipc.override('plugin:dialog|open', () => 'D:/Games/Control/Control.exe')

    await expect(pickExecutable('Locate game executable')).resolves.toBe(
      'D:/Games/Control/Control.exe'
    )
    const [call] = ipc.calls('plugin:dialog|open') as { options: Record<string, unknown> }[]
    expect(call.options).toMatchObject({
      directory: false,
      multiple: false,
      title: 'Locate game executable',
      filters: [{ name: 'Applications', extensions: ['exe'] }],
    })
  })

  it('returns null when the picker is cancelled', async () => {
    await expect(pickExecutable('Locate game executable')).resolves.toBeNull()
  })
})
