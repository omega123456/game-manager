import { describe, expect, it, vi } from 'vitest'

import { logFrontend } from '../../lib/app-log-commands'
import { ipc } from '../ipc-mock'

describe('logFrontend', () => {
  it('forwards level, message, and details to the log_frontend command', async () => {
    logFrontend('info', 'started', { category: 'boot', details: 'detail' })

    await vi.waitFor(() => {
      expect(ipc.calls('log_frontend')).toHaveLength(1)
    })
    expect(ipc.calls('log_frontend')[0]).toEqual({
      level: 'info',
      message: 'started',
      category: 'boot',
      details: 'detail',
    })
  })

  it('falls back to a single console line when IPC rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    ipc.override('log_frontend', () => {
      throw new Error('ipc unavailable')
    })

    logFrontend('error', 'boom')

    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('[app-log]', 'error', 'boom', expect.any(Error))
    })
    consoleError.mockRestore()
  })
})
