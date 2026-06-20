import { create } from 'zustand'

/** Visual tone of a toast notification. */
export type ToastTone = 'info' | 'success' | 'error'

/** Optional action button rendered inside a toast. */
export interface ToastAction {
  label: string
  onClick: () => void
}

/** Determinate progress rendered as a bar inside a toast (e.g. a library scan). */
export interface ToastProgress {
  current: number
  total: number
}

export interface Toast {
  id: number
  tone: ToastTone
  title: string
  description?: string
  /** When true, the toast stays until dismissed (no auto-dismiss timer). */
  persistent?: boolean
  /** Optional action button rendered alongside the dismiss control. */
  action?: ToastAction
  /** Optional determinate progress bar (current/total) rendered in the body. */
  progress?: ToastProgress
}

interface ToastState {
  toasts: Toast[]
  /** Push a toast and return its id. */
  push: (toast: Omit<Toast, 'id'>) => number
  /** Patch an existing toast in place (e.g. live-update progress counts). */
  update: (id: number, patch: Partial<Omit<Toast, 'id'>>) => void
  /** Remove a toast by id. */
  dismiss: (id: number) => void
}

let nextToastId = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = ++nextToastId
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }))
    return id
  },
  update: (id, patch) =>
    set((state) => ({
      toasts: state.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))
