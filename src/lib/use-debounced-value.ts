import { useEffect, useState } from 'react'

/**
 * Return a debounced copy of `value` that only updates after `delayMs` have
 * elapsed without further changes. Useful for throttling query-triggering input
 * (e.g. a free-text search box) so a backend call fires once the user pauses
 * typing rather than on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
