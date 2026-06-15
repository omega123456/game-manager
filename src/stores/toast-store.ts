import { create } from 'zustand'

/** Visual tone of a toast notification. */
export type ToastTone = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  tone: ToastTone
  title: string
  description?: string
}

interface ToastState {
  toasts: Toast[]
  /** Push a toast and return its id. */
  push: (toast: Omit<Toast, 'id'>) => number
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
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))
