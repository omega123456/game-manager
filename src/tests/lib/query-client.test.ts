import { describe, expect, it } from 'vitest'

import { createQueryClient } from '@/lib/query-client'

describe('query-client', () => {
  it('builds a client with the configured defaults', () => {
    const client = createQueryClient()
    const defaults = client.getDefaultOptions().queries
    expect(defaults?.staleTime).toBe(30_000)
    expect(defaults?.retry).toBe(1)
    expect(defaults?.refetchOnWindowFocus).toBe(false)
  })
})
