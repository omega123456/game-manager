import { type ReactNode, type RefObject } from 'react'

import { ScrollContainerContext } from '@/components/layout/use-scroll-container'

export interface ScrollContainerProviderProps {
  /** Ref to the bounded scroll container (the app shell's `<main>`). */
  scrollRef: RefObject<HTMLElement | null>
  children: ReactNode
}

/** Provides the scroll-container ref to descendant route content. */
export function ScrollContainerProvider({
  scrollRef,
  children,
}: ScrollContainerProviderProps): React.JSX.Element {
  return (
    <ScrollContainerContext.Provider value={scrollRef}>{children}</ScrollContainerContext.Provider>
  )
}
