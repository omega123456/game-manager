import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { create } from 'zustand'

import { logFrontend } from '@/lib/app-log-commands'
import { hasTauriApis } from '@/lib/tauri-env'

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'installing'
  | 'ready-to-restart'
  | 'error'

type UpdateProgressEvent =
  | { event: 'Started'; data?: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

interface UpdateState {
  status: UpdateStatus
  availableVersion: string | null
  downloadProgress: number
  errorMessage: string | null
  hasCheckedOnStartup: boolean
  updateObject: Update | null
  checkForUpdate: (manual: boolean) => Promise<void>
  checkOnStartup: () => Promise<void>
  downloadAndInstall: () => Promise<void>
  restartToApplyUpdate: () => Promise<void>
}

let resetStatusTimer: ReturnType<typeof setTimeout> | null = null

function clearResetStatusTimer(): void {
  if (resetStatusTimer !== null) {
    clearTimeout(resetStatusTimer)
    resetStatusTimer = null
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resetUpdateState(set: (partial: Partial<UpdateState>) => void): void {
  set({
    status: 'idle',
    availableVersion: null,
    downloadProgress: 0,
    errorMessage: null,
    updateObject: null,
  })
}

function scheduleUpToDateReset(set: (partial: Partial<UpdateState>) => void): void {
  set({
    status: 'up-to-date',
    availableVersion: null,
    errorMessage: null,
    updateObject: null,
  })
  resetStatusTimer = setTimeout(() => {
    resetStatusTimer = null
    useUpdateStore.setState((currentState) => {
      if (currentState.status !== 'up-to-date') {
        return currentState
      }

      return {
        ...currentState,
        status: 'idle',
        availableVersion: null,
        errorMessage: null,
        updateObject: null,
      }
    })
  }, 5_000)
}

export const useUpdateStore = create<UpdateState>()((set, get) => ({
  status: 'idle',
  availableVersion: null,
  downloadProgress: 0,
  errorMessage: null,
  hasCheckedOnStartup: false,
  updateObject: null,

  checkForUpdate: async (manual: boolean) => {
    const state = get()
    if (
      state.status === 'checking' ||
      state.status === 'installing' ||
      state.status === 'ready-to-restart'
    ) {
      return
    }

    clearResetStatusTimer()

    if (!hasTauriApis()) {
      resetUpdateState(set)
      return
    }

    set({
      status: 'checking',
      availableVersion: null,
      downloadProgress: 0,
      errorMessage: null,
      updateObject: null,
    })

    try {
      const update = (await check()) as Update | null

      if (update) {
        set({
          status: 'available',
          availableVersion: update.version ?? null,
          downloadProgress: 0,
          errorMessage: null,
          updateObject: update,
        })
        return
      }

      if (manual) {
        scheduleUpToDateReset(set)
        return
      }

      resetUpdateState(set)
    } catch (error) {
      const message = toErrorMessage(error)
      logFrontend('error', `[update-store] ${manual ? 'Manual' : 'Startup'} update check failed`, {
        category: 'settings.updates',
        details: message,
      })

      if (manual) {
        set({
          status: 'error',
          errorMessage: message,
          availableVersion: null,
          updateObject: null,
        })
        return
      }

      resetUpdateState(set)
    }
  },

  checkOnStartup: async () => {
    if (get().hasCheckedOnStartup) {
      return
    }

    set({ hasCheckedOnStartup: true })
    await get().checkForUpdate(false)
  },

  downloadAndInstall: async () => {
    clearResetStatusTimer()

    if (!hasTauriApis()) {
      resetUpdateState(set)
      return
    }

    const updateObject = get().updateObject
    if (!updateObject) {
      const message = 'No update is available to install.'
      logFrontend('error', '[update-store] Install failed', {
        category: 'settings.updates',
        details: message,
      })
      set({
        status: 'error',
        errorMessage: message,
      })
      return
    }

    let contentLength: number | null = null
    let downloaded = 0

    set({
      status: 'installing',
      downloadProgress: 0,
      errorMessage: null,
    })

    try {
      await updateObject.downloadAndInstall((event: UpdateProgressEvent) => {
        if (event.event === 'Started') {
          const total = event.data?.contentLength
          contentLength = typeof total === 'number' && total > 0 ? total : null
          downloaded = 0
          set({ downloadProgress: 0 })
          return
        }

        if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          if (contentLength && contentLength > 0) {
            const percent = Math.min(100, Math.round((downloaded / contentLength) * 100))
            set({ downloadProgress: percent })
          }
          return
        }

        if (event.event === 'Finished') {
          set({ downloadProgress: 100 })
        }
      })

      set({
        status: 'ready-to-restart',
        availableVersion: updateObject.version ?? null,
        downloadProgress: 100,
        errorMessage: null,
        updateObject: null,
      })
    } catch (error) {
      const message = toErrorMessage(error)
      logFrontend('error', '[update-store] Install failed', {
        category: 'settings.updates',
        details: message,
      })
      set({
        status: 'error',
        errorMessage: message,
        updateObject: null,
      })
    }
  },

  restartToApplyUpdate: async () => {
    if (!hasTauriApis()) {
      return
    }

    try {
      await relaunch()
    } catch (error) {
      const message = toErrorMessage(error)
      logFrontend('error', '[update-store] Restart failed', {
        category: 'settings.updates',
        details: message,
      })
      set({
        status: 'ready-to-restart',
        errorMessage: message,
      })
    }
  },
}))
