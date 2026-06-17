import { afterEach, describe, expect, it } from 'vitest'

import { isElevationError, showElevationToast } from '@/features/dlss/elevation-toast'
import { useToastStore } from '@/stores/toast-store'

import { ipc } from '../../ipc-mock'

describe('isElevationError', () => {
  it('detects privilege/admin/access-denied messages', () => {
    expect(isElevationError(new Error('Access denied'))).toBe(true)
    expect(isElevationError('requires elevation')).toBe(true)
    expect(isElevationError(new Error('Administrator required'))).toBe(true)
    expect(isElevationError('InvalidUserPrivilege')).toBe(true)
  })
  it('returns false for unrelated errors', () => {
    expect(isElevationError(new Error('network timeout'))).toBe(false)
  })
})

describe('showElevationToast', () => {
  afterEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('pushes a persistent error toast with a relaunch action', async () => {
    showElevationToast('detail')
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({
      tone: 'error',
      title: 'Administrator access required',
      persistent: true,
    })
    expect(toasts[0].action?.label).toBe('Relaunch as Administrator')

    toasts[0].action?.onClick()
    await ipc.emit('noop')
    expect(ipc.calls('dlss_relaunch_elevated')).toEqual([{}])
  })
})
