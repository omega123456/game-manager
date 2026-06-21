import { createContext, useContext, type RefObject } from 'react'

/**
 * Shares the app shell's scrolling `<main>` element down to route content so a
 * virtualizer can use it as its scroll container via `getScrollElement`. The
 * context value is a ref whose `.current` is populated once `<main>` mounts.
 */
export const ScrollContainerContext = createContext<RefObject<HTMLElement | null> | null>(null)

/**
 * Returns the shared scroll-container ref, or `null` when rendered outside a
 * provider (e.g. in isolated unit tests). Consumers must tolerate a `null`
 * `.current` until the container mounts.
 */
export function useScrollContainerRef(): RefObject<HTMLElement | null> | null {
  return useContext(ScrollContainerContext)
}
