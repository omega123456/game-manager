import { useMemo, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { useGamesQuery } from '@/lib/queries/use-games'
import { useGroupsQuery } from '@/lib/queries/use-groups'
import { useScriptsQuery } from '@/lib/queries/use-scripts'
import type { Group } from '@/types/domain'

import { GroupDetailPanel } from './group-detail-panel'
import { GroupList } from './group-list'

type Selection = { mode: 'none' } | { mode: 'new' } | { mode: 'edit'; id: number }

export function GroupManagerContent(): React.JSX.Element {
  const groupsQuery = useGroupsQuery()
  const scriptsQuery = useScriptsQuery()
  const gamesQuery = useGamesQuery()

  const groups = useMemo(
    () => [...(groupsQuery.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [groupsQuery.data]
  )

  const [selection, setSelection] = useState<Selection>({ mode: 'none' })
  const [pendingSelectedGroup, setPendingSelectedGroup] = useState<Group | null>(null)

  const selectedGroup: Group | null =
    selection.mode === 'edit'
      ? groups.find((group) => group.id === selection.id) ??
        (pendingSelectedGroup?.id === selection.id ? pendingSelectedGroup : null)
      : null

  const selectedId = selection.mode === 'edit' ? selection.id : null

  const groupCountById = useMemo(
    () => new Map(groups.map((group) => [group.id, group.gameIds.length])),
    [groups]
  )
  const scriptCountById = useMemo(
    () => new Map(groups.map((group) => [group.id, group.scriptIds.length])),
    [groups]
  )

  const editorKey =
    selection.mode === 'edit' ? `edit-${selection.id}` : selection.mode === 'new' ? 'new' : 'none'

  return (
    <div className="grid h-full grid-cols-[20rem_1fr] overflow-hidden" data-testid="group-manager">
      <h1 className="sr-only">Group Manager</h1>
      <GroupList
        groups={groups}
        selectedId={selectedId}
        gameCountByGroupId={groupCountById}
        scriptCountByGroupId={scriptCountById}
        onSelect={(id) => setSelection({ mode: 'edit', id })}
        onNew={() => {
          setPendingSelectedGroup(null)
          setSelection({ mode: 'new' })
        }}
      />

      <div className="h-full overflow-hidden">
        {selection.mode === 'none' || (selection.mode === 'edit' && !selectedGroup) ? (
          <div
            className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
            data-testid="group-detail-empty"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon name="groups" className="text-[28px]" />
            </span>
            <h2 className="font-heading text-lg font-semibold text-foreground">
              Select or create a group
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Use groups to share script assignments across related games without duplicating setup.
            </p>
          </div>
        ) : (
          <GroupDetailPanel
            key={editorKey}
            group={selectedGroup}
            scripts={scriptsQuery.data ?? []}
            games={gamesQuery.data ?? []}
            onSaved={(group) => {
              setPendingSelectedGroup(group)
              setSelection({ mode: 'edit', id: group.id })
            }}
            onDeleted={() => {
              setPendingSelectedGroup(null)
              setSelection({ mode: 'none' })
            }}
          />
        )}
      </div>
    </div>
  )
}
