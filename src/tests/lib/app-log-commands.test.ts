import { afterEach, describe, expect, it, vi } from 'vitest'

import { logFrontend, shouldEmitFrontendLog, toast, toastError } from '../../lib/app-log-commands'
import { useToastStore } from '../../stores/toast-store'
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

describe('shouldEmitFrontendLog', () => {
  it('keeps trace+ enabled in development', () => {
    expect(shouldEmitFrontendLog('trace', true)).toBe(true)
    expect(shouldEmitFrontendLog('debug', true)).toBe(true)
  })

  it('limits production to info and above', () => {
    expect(shouldEmitFrontendLog('trace', false)).toBe(false)
    expect(shouldEmitFrontendLog('debug', false)).toBe(false)
    expect(shouldEmitFrontendLog('info', false)).toBe(true)
    expect(shouldEmitFrontendLog('warn', false)).toBe(true)
    expect(shouldEmitFrontendLog('error', false)).toBe(true)
  })
})

describe('toast action + persistent threading', () => {
  afterEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('forwards persistent and action to the toast store', () => {
    const onClick = vi.fn()
    toast('info', 'Batch done', {
      description: '10 of 12 games',
      persistent: true,
      action: { label: 'View details', onClick },
    })

    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({
      tone: 'info',
      title: 'Batch done',
      description: '10 of 12 games',
      persistent: true,
      action: { label: 'View details' },
    })
    toasts[0].action?.onClick()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('toastError threads action + persistent', () => {
    toastError('Administrator access required', {
      persistent: true,
      action: { label: 'Relaunch', onClick: vi.fn() },
    })
    const toasts = useToastStore.getState().toasts
    expect(toasts[0]).toMatchObject({ tone: 'error', persistent: true })
    expect(toasts[0].action?.label).toBe('Relaunch')
  })
})
