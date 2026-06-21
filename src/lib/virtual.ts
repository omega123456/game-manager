/**
 * Local re-export of `@tanstack/react-virtual`'s `useVirtualizer`.
 *
 * `useVirtualizer` returns intentionally non-memoizable functions, which is
 * correct for a virtualizer (its API is stateful by design). Components that use
 * it must opt out of React Compiler memoization via the `'use no memo'`
 * directive. Routing the import through this module keeps the directive as the
 * single source of truth for that opt-out, rather than relying on the compiler's
 * package-name heuristic for the upstream specifier.
 */
export { useVirtualizer } from '@tanstack/react-virtual'
export type { Virtualizer } from '@tanstack/react-virtual'
