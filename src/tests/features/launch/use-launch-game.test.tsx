import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useLaunchGame } from '@/features/launch/use-launch-game'
import { GAMES_QUERY_KEY } from '@/lib/queries/query-keys'
import { gameDetailQueryKey } from '@/lib/queries/use-games'
import { useLaunchStore } from '@/stores/launch-store'
import { useToastStore } from '@/stores/toast-store'
import { makeGame } from '@/tests/helpers/game-factory'
import { ipc } from '@/tests/ipc-mock'

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(GAMES_QUERY_KEY, [makeGame({ id: 4 })])
  client.setQueryData(gameDetailQueryKey(4), makeGame({ id: 4 }))
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useLaunchGame(), { wrapper: Wrapper })
  return { client, launch: result.current }
}

describe('useLaunchGame', () => {
  beforeEach(() => {
    useLaunchStore.getState().reset()
    useToastStore.setState({ toasts: [] })
  })

  it('launches the game', async () => {
    const { launch } = setup()

    act(() => launch(4, 'Hades II'))

    await waitFor(() => expect(ipc.calls('launch_game')).toEqual([{ gameId: 4 }]))
    expect(useLaunchStore.getState().gameName).toBe('Hades II')
  })

  it('refreshes game caches when the launch fails', async () => {
    ipc.override('launch_game', () => {
      throw new Error("Hades II isn't installed: drive E: isn't connected.")
    })
    const { client, launch } = setup()

    act(() => launch(4, 'Hades II'))

    await waitFor(() => expect(client.getQueryState(GAMES_QUERY_KEY)?.isInvalidated).toBe(true))
    expect(client.getQueryState(gameDetailQueryKey(4))?.isInvalidated).toBe(true)
  })
})
