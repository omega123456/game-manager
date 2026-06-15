import { useState } from 'react'

import { toastError } from '@/lib/app-log-commands'
import {
  useResolvedScriptsQuery,
  useSetGameGroupsMutation,
  useSetGameScriptsMutation,
} from '@/lib/queries/use-games'
import { useGroupsQuery } from '@/lib/queries/use-groups'
import { useScriptsQuery } from '@/lib/queries/use-scripts'
import type { Game, Group, Script } from '@/types/domain'

import { GameGroupMembership } from './game-group-membership'
import { GameScriptAssignment } from './game-script-assignment'
import { ResolvedScriptPreview } from './resolved-script-preview'

export interface GameDetailScriptsTabProps {
  game: Game
}

interface OptimisticAssignmentState {
  gameId: number
  ids: number[]
}

export function GameDetailScriptsTab({ game }: GameDetailScriptsTabProps): React.JSX.Element {
  const scriptsQuery = useScriptsQuery()
  const groupsQuery = useGroupsQuery()
  const resolvedScriptsQuery = useResolvedScriptsQuery(game.id)
  const setGameScriptsMutation = useSetGameScriptsMutation()
  const setGameGroupsMutation = useSetGameGroupsMutation()

  const scripts = scriptsQuery.data ?? []
  const groups = groupsQuery.data ?? []
  const [optimisticScriptIds, setOptimisticScriptIds] =
    useState<OptimisticAssignmentState | null>(null)
  const [optimisticGroupIds, setOptimisticGroupIds] =
    useState<OptimisticAssignmentState | null>(null)
  const directScriptIds =
    optimisticScriptIds?.gameId === game.id ? optimisticScriptIds.ids : game.scriptIds
  const selectedGroupIds =
    optimisticGroupIds?.gameId === game.id ? optimisticGroupIds.ids : game.groupIds
  const inheritedScriptIds = resolveInheritedScriptIds(scripts, groups, selectedGroupIds)
  const assignmentsPending = setGameScriptsMutation.isPending || setGameGroupsMutation.isPending

  async function updateScriptIds(nextScriptIds: number[]): Promise<void> {
    if (setGameScriptsMutation.isPending) {
      return
    }

    const previousScriptIds = directScriptIds
    setOptimisticScriptIds({ gameId: game.id, ids: nextScriptIds })
    try {
      const savedScriptIds = await setGameScriptsMutation.mutateAsync({
        gameId: game.id,
        scriptIds: nextScriptIds,
      })
      setOptimisticScriptIds({ gameId: game.id, ids: savedScriptIds })
    } catch (error) {
      setOptimisticScriptIds({ gameId: game.id, ids: previousScriptIds })
      const details = error instanceof Error ? error.message : String(error)
      toastError('Could not update game scripts', {
        description: game.name,
        category: 'games.scripts',
        details,
      })
    }
  }

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
    <div className="space-y-5" data-testid="game-detail-scripts-tab">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-5">
          <GameScriptAssignment
            scripts={scripts}
            assignedScriptIds={directScriptIds}
            title="Direct scripts"
            description="Only normal scripts can be assigned directly to a game."
            emptyLabel="No direct scripts assigned yet."
            triggerLabel="Add script"
            disabled={assignmentsPending}
            onAssign={(scriptId) => void updateScriptIds([...directScriptIds, scriptId])}
            onRemove={(scriptId) =>
              void updateScriptIds(directScriptIds.filter((currentId) => currentId !== scriptId))
            }
          />
          <GameScriptAssignment
            scripts={scripts}
            assignedScriptIds={inheritedScriptIds}
            title="Inherited scripts"
            description="These come from the groups this game belongs to and are read-only here."
            emptyLabel="No inherited scripts yet."
            triggerLabel=""
            disabled
            onAssign={() => undefined}
          />
          <GameGroupMembership
            groups={groups}
            selectedGroupIds={selectedGroupIds}
            disabled={assignmentsPending}
            onAssign={(groupId) => void updateGroupIds([...selectedGroupIds, groupId])}
            onRemove={(groupId) =>
              void updateGroupIds(selectedGroupIds.filter((currentId) => currentId !== groupId))
            }
          />
        </div>

        <ResolvedScriptPreview scripts={resolvedScriptsQuery.data ?? []} />
      </div>
    </div>
  )
}

function resolveInheritedScriptIds(
  scripts: Script[],
  groups: Group[],
  selectedGroupIds: number[]
): number[] {
  const normalScriptIds = new Set(
    groups
      .filter((group) => selectedGroupIds.includes(group.id))
      .flatMap((group) => group.scriptIds)
  )

  return scripts
    .filter((script) => normalScriptIds.has(script.id) && script.kind === 'normal')
    .map((script) => script.id)
}
