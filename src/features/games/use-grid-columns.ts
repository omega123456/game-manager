import { useCallback, useEffect, useRef, useState } from 'react'

/** Card track width in px — mirrors the `repeat(auto-fill, 220px)` track. */
const TRACK = 220
/** Inter-card gap in px — mirrors Tailwind `gap-4` (1rem). */
const GAP = 16

/**
 * Derives the integer column count for a measured content width, exactly
 * reproducing `repeat(auto-fill, 220px)` with a `1rem` gap. With a leading gap
 * conceptually prepended to every track, `n` columns fit when
 * `n * (TRACK + GAP) - GAP <= width`, i.e. `n = floor((width + GAP) / (TRACK + GAP))`.
 * Clamped to a minimum of 1.
 */
export function columnsForWidth(width: number): number {
  if (width <= 0) {
    return 1
  }
  return Math.max(1, Math.floor((width + GAP) / (TRACK + GAP)))
}

export interface GridColumns {
  /** Current responsive column count, matching the original CSS auto-fill grid. */
  columns: number
  /**
   * Callback ref for the grid container `<div>`. Observes its content width (via
   * `ResizeObserver` on `clientWidth`, inside the route wrapper padding) and
   * keeps `columns` in sync. Pass `null` to detach.
   */
  observe: (node: HTMLElement | null) => void
}

/**
 * Tracks the grid container's responsive column count without reading any ref
 * during render. The returned `observe` callback ref attaches a
 * `ResizeObserver` to the container; `columns` updates as its width changes.
 */
export function useGridColumns(): GridColumns {
  const [columns, setColumns] = useState(1)
  const observerRef = useRef<ResizeObserver | null>(null)

  const observe = useCallback((node: HTMLElement | null): void => {
    observerRef.current?.disconnect()
    observerRef.current = null

    if (!node) {
      return
    }

    const update = (): void => {
      setColumns(columnsForWidth(node.clientWidth))
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    observerRef.current = observer
  }, [])

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect()
      observerRef.current = null
    }
  }, [])

  return { columns, observe }
}
