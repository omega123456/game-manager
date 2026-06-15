import { useState } from 'react'

import { toastError } from '@/lib/app-log-commands'
import { useSetGameGroupsMutation } from '@/lib/queries/use-games'
import { useGroupsQuery } from '@/lib/queries/use-groups'
import type { Game } from '@/types/domain'

import { GameGroupMembership } from './game-group-membership'

export interface GameDetailGroupsTabProps {
  game: Game
}

interface OptimisticGroupIdsState {
  gameId: number
  ids: number[]
}

export function GameDetailGroupsTab({ game }: GameDetailGroupsTabProps): React.JSX.Element {
  const groupsQuery = useGroupsQuery()
  const setGameGroupsMutation = useSetGameGroupsMutation()
  const groups = groupsQuery.data ?? []
  const [optimisticGroupIds, setOptimisticGroupIds] = useState<OptimisticGroupIdsState | null>(null)
  const selectedGroupIds =
    optimisticGroupIds?.gameId === game.id ? optimisticGroupIds.ids : game.groupIds

  async function updateGroupIds(nextGroupIds: number[]): Promise<void> {
    if (setGameGroupsMutation.isPending) {
      return
    }

    const previousGroupIds = selectedGroupIds
    setOptimisticGroupIds({ gameId: game.id, ids: nextGroupIds })
    try {
      const savedGroupIds = await setGameGroupsMutation.mutateAsync({
        gameId: game.id,
        groupIds: nextGroupIds,
      })
      setOptimisticGroupIds({ gameId: game.id, ids: savedGroupIds })
    } catch (error) {
      setOptimisticGroupIds({ gameId: game.id, ids: previousGroupIds })
      const details = error instanceof Error ? error.message : String(error)
      toastError('Could not update game groups', {
        description: game.name,
        category: 'games.groups',
        details,
      })
    }
  }

  return (
    <div className="space-y-5" data-testid="game-detail-groups-tab">
      <GameGroupMembership
        groups={groups}
        selectedGroupIds={selectedGroupIds}
        disabled={setGameGroupsMutation.isPending}
        onAssign={(groupId) => void updateGroupIds([...selectedGroupIds, groupId])}
        onRemove={(groupId) =>
          void updateGroupIds(selectedGroupIds.filter((currentId) => currentId !== groupId))
        }
      />
    </div>
  )
}
