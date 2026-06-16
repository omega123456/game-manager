import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '../ipc-mock'
import { useUpdateStore } from '@/stores/update-store'

function makeAvailableUpdate(version = '0.2.0') {
  return {
    rid: 101,
    version,
    currentVersion: '0.1.0',
    date: '2026-06-16T12:00:00.000Z',
    body: `Release ${version}`,
    rawJson: null,
  }
}

describe('useUpdateStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useUpdateStore.setState({
      status: 'idle',
      availableVersion: null,
      downloadProgress: 0,
      errorMessage: null,
      hasCheckedOnStartup: false,
      updateObject: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sets available state when a manual check finds an update', async () => {
    ipc.override('plugin:updater|check', () => makeAvailableUpdate())

    await useUpdateStore.getState().checkForUpdate(true)

    expect(useUpdateStore.getState()).toMatchObject({
      status: 'available',
      availableVersion: '0.2.0',
      errorMessage: null,
    })
  })

  it('shows up-to-date after a manual check with no update, then resets to idle', async () => {
    ipc.override('plugin:updater|check', () => null)

    await useUpdateStore.getState().checkForUpdate(true)
    expect(useUpdateStore.getState().status).toBe('up-to-date')

    await vi.advanceTimersByTimeAsync(5_000)
    expect(useUpdateStore.getState().status).toBe('idle')
  })

  it('tracks install progress and moves into ready-to-restart', async () => {
    ipc.override('plugin:updater|check', () => makeAvailableUpdate())
    ipc.override('plugin:updater|download_and_install', (args) => {
      const onEvent = args?.onEvent as { onmessage?: (event: unknown) => void } | undefined
      onEvent?.onmessage?.({ event: 'Started', data: { contentLength: 100 } })
      onEvent?.onmessage?.({ event: 'Progress', data: { chunkLength: 25 } })
      onEvent?.onmessage?.({ event: 'Progress', data: { chunkLength: 75 } })
      onEvent?.onmessage?.({ event: 'Finished' })
      return null
    })

    await useUpdateStore.getState().checkForUpdate(true)
    await useUpdateStore.getState().downloadAndInstall()

    expect(useUpdateStore.getState()).toMatchObject({
      status: 'ready-to-restart',
      availableVersion: '0.2.0',
      downloadProgress: 100,
    })
  })

  it('restarts through the process plugin', async () => {
    useUpdateStore.setState({
      status: 'ready-to-restart',
      availableVersion: '0.2.0',
      downloadProgress: 100,
      errorMessage: null,
      updateObject: null,
    })

    await useUpdateStore.getState().restartToApplyUpdate()

    expect(ipc.calls('plugin:process|restart')).toHaveLength(1)
  })

  it('only runs the startup check once', async () => {
    ipc.override('plugin:updater|check', () => null)

    await useUpdateStore.getState().checkOnStartup()
    await useUpdateStore.getState().checkOnStartup()

    expect(ipc.calls('plugin:updater|check')).toHaveLength(1)
    expect(useUpdateStore.getState().hasCheckedOnStartup).toBe(true)
  })
})
