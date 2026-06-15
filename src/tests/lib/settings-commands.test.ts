import { describe, expect, it } from 'vitest'

import {
  getAllSettings,
  getSetting,
  setSetting,
  setSettingFireAndForget,
} from '@/lib/ipc/settings-commands'
import { ipc } from '../ipc-mock'

describe('settings-commands', () => {
  describe('setSettingFireAndForget', () => {
    it('invokes set_setting with key and value', async () => {
      setSettingFireAndForget('theme', 'dark')
      // Flush the fire-and-forget microtask chain.
      await Promise.resolve()
      expect(ipc.calls('set_setting')).toEqual([{ key: 'theme', value: 'dark' }])
    })

    it('swallows backend rejection without throwing', async () => {
      ipc.override('set_setting', () => {
        throw new Error('command not registered')
      })
      expect(() => setSettingFireAndForget('accent', 'violet')).not.toThrow()
      await Promise.resolve()
      expect(ipc.calls('set_setting').length).toBeGreaterThan(0)
    })
  })

  describe('getAllSettings', () => {
    it('returns the rows from the backend', async () => {
      ipc.override('get_all_settings', () => [
        { key: 'theme', value: 'dark' },
        { key: 'steam_api_key', value: null },
      ])
      const rows = await getAllSettings()
      expect(rows).toEqual([
        { key: 'theme', value: 'dark' },
        { key: 'steam_api_key', value: null },
      ])
    })
  })

  describe('getSetting', () => {
    it('passes the key and returns the value', async () => {
      ipc.override('get_setting', (args) => (args?.key === 'theme' ? 'light' : null))
      await expect(getSetting('theme')).resolves.toBe('light')
      expect(ipc.calls('get_setting')).toEqual([{ key: 'theme' }])
    })
  })

  describe('setSetting', () => {
    it('awaits and rejects on backend failure', async () => {
      ipc.override('set_setting', () => {
        throw new Error('boom')
      })
      await expect(setSetting('theme', 'dark')).rejects.toThrow('boom')
    })

    it('resolves on success', async () => {
      await expect(setSetting('theme', 'dark')).resolves.toBeUndefined()
      expect(ipc.calls('set_setting')).toContainEqual({ key: 'theme', value: 'dark' })
    })
  })
})
