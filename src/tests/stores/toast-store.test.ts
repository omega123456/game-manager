import { beforeEach, describe, expect, it } from 'vitest'

import { useToastStore } from '@/stores/toast-store'

describe('toast-store', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('pushes a toast and returns its id', () => {
    const id = useToastStore.getState().push({ tone: 'info', title: 'Hi' })
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ id, tone: 'info', title: 'Hi' })
  })

  it('updates an existing toast in place', () => {
    const id = useToastStore.getState().push({
      tone: 'info',
      title: 'Scanning DLSS…',
      progress: { current: 1, total: 5 },
    })
    useToastStore.getState().update(id, { progress: { current: 4, total: 5 } })
    expect(useToastStore.getState().toasts[0].progress).toEqual({ current: 4, total: 5 })
  })

  it('leaves other toasts untouched when updating one', () => {
    const first = useToastStore.getState().push({ tone: 'info', title: 'First' })
    const second = useToastStore.getState().push({ tone: 'success', title: 'Second' })
    useToastStore.getState().update(second, { title: 'Second!' })
    const byId = new Map(useToastStore.getState().toasts.map((t) => [t.id, t]))
    expect(byId.get(first)?.title).toBe('First')
    expect(byId.get(second)?.title).toBe('Second!')
  })

  it('dismisses a toast by id', () => {
    const id = useToastStore.getState().push({ tone: 'error', title: 'Boom' })
    useToastStore.getState().dismiss(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
