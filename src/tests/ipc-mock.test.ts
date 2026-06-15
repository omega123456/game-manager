import { invoke } from '@tauri-apps/api/core'
import { describe, expect, it } from 'vitest'

import { ipc } from './ipc-mock'

describe('IPC mock harness', () => {
  it('throws on an unmocked Tauri IPC command (contract)', async () => {
    await expect(invoke('some_unregistered_command')).rejects.toThrow(
      '[vitest] Unmocked Tauri IPC command: some_unregistered_command'
    )
  })

  it('serves a default fixture response', async () => {
    await expect(invoke('log_frontend', { level: 'info', message: 'x' })).resolves.toBeUndefined()
  })

  it('honors a per-test override and records calls', async () => {
    ipc.override('list_games', () => [{ id: 1, name: 'Elden Ring' }])
    const result = await invoke('list_games')
    expect(result).toEqual([{ id: 1, name: 'Elden Ring' }])
    expect(ipc.calls('list_games')).toHaveLength(1)
  })

  it('rejects wildcard overrides', () => {
    expect(() => ipc.override('*', () => null)).toThrow('Wildcard override not allowed')
  })
})
