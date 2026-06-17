import { useState } from 'react'

import { toastError } from '@/lib/app-log-commands'
import { useResolvedScriptsQuery, useSetGameScriptsMutation } from '@/lib/queries/use-games'
import { useGroupsQuery } from '@/lib/queries/use-groups'
import { useScriptsQuery } from '@/lib/queries/use-scripts'
import type { Game, Group, Script } from '@/types/domain'

import { GameScriptAssignment } from './game-script-assignment'
import { ResolvedScriptPreview } from './resolved-script-preview'

export interface GameDetailScriptsTabProps {
  game: Game
}

interface OptimisticScriptIdsState {
  gameId: number
  ids: number[]
}

export function GameDetailScriptsTab({ game }: GameDetailScriptsTabProps): React.JSX.Element {
  const scriptsQuery = useScriptsQuery()
  const groupsQuery = useGroupsQuery()
  const resolvedScriptsQuery = useResolvedScriptsQuery(game.id)
  const setGameScriptsMutation = useSetGameScriptsMutation()

  const scripts = scriptsQuery.data ?? []
  const groups = groupsQuery.data ?? []
  const [optimisticScriptIds, setOptimisticScriptIds] = useState<OptimisticScriptIdsState | null>(
    null
  )
  const directScriptIds =
    optimisticScriptIds?.gameId === game.id ? optimisticScriptIds.ids : game.scriptIds
  const inheritedScriptIds = resolveInheritedScriptIds(scripts, groups, game.groupIds)

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

  return (
    <div className="space-y-5" data-testid="game-detail-scripts-tab">
      <GameScriptAssignment
        scripts={scripts}
        assignedScriptIds={directScriptIds}
        title="Direct scripts"
        description="Only normal scripts can be assigned directly to a game."
        emptyLabel="No direct scripts assigned yet."
        triggerLabel="Add script"
        disabled={setGameScriptsMutation.isPending}
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
      <ResolvedScriptPreview scripts={resolvedScriptsQuery.data ?? []} />
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
