import { useEffect, useRef, useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toastError, toastSuccess } from '@/lib/app-log-commands'
import {
  useCreateGroupMutation,
  useDeleteGroupMutation,
  useSetGroupGamesMutation,
  useSetGroupScriptsMutation,
  useUpdateGroupMutation,
} from '@/lib/queries/use-groups'
import type { Game, Group, Script } from '@/types/domain'

import { GroupMembers } from './group-members'
import { GroupScriptAssignment } from './group-script-assignment'

export interface GroupDetailPanelProps {
  group: Group | null
  scripts: Script[]
  games: Game[]
  onSaved: (group: Group) => void
  onDeleted: () => void
}

interface DraftState {
  name: string
  description: string
}

function buildDraft(group: Group | null): DraftState {
  return {
    name: group?.name ?? '',
    description: group?.description ?? '',
  }
}

export function GroupDetailPanel({
  group,
  scripts,
  games,
  onSaved,
  onDeleted,
}: GroupDetailPanelProps): React.JSX.Element {
  const createGroupMutation = useCreateGroupMutation()
  const updateGroupMutation = useUpdateGroupMutation()
  const deleteGroupMutation = useDeleteGroupMutation()
  const setGroupScriptsMutation = useSetGroupScriptsMutation()
  const setGroupGamesMutation = useSetGroupGamesMutation()

  const [draft, setDraft] = useState<DraftState>(() => buildDraft(group))
  const [nameError, setNameError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [optimisticScriptIds, setOptimisticScriptIds] = useState<number[] | null>(null)
  const [confirmedScriptIds, setConfirmedScriptIds] = useState<string | null>(null)
  const [optimisticGameIds, setOptimisticGameIds] = useState<number[] | null>(null)
  const [confirmedGameIds, setConfirmedGameIds] = useState<string | null>(null)

  const isPending =
    createGroupMutation.isPending ||
    updateGroupMutation.isPending ||
    deleteGroupMutation.isPending ||
    setGroupScriptsMutation.isPending ||
    setGroupGamesMutation.isPending
  const assignedScriptIds = optimisticScriptIds ?? group?.scriptIds ?? []
  const memberGameIds = optimisticGameIds ?? group?.gameIds ?? []
  const groupScriptIdsSignature = buildIdsSignature(group?.scriptIds ?? [])
  const previousGroupScriptIdsSignature = useRef(groupScriptIdsSignature)
  const groupGameIdsSignature = buildIdsSignature(group?.gameIds ?? [])
  const previousGroupGameIdsSignature = useRef(groupGameIdsSignature)

  useEffect(() => {
    const groupScriptIdsChanged =
      previousGroupScriptIdsSignature.current !== groupScriptIdsSignature
    if (
      optimisticScriptIds &&
      (groupScriptIdsSignature === confirmedScriptIds || groupScriptIdsChanged)
    ) {
      setOptimisticScriptIds(null)
      setConfirmedScriptIds(null)
    }
    previousGroupScriptIdsSignature.current = groupScriptIdsSignature
  }, [confirmedScriptIds, groupScriptIdsSignature, optimisticScriptIds])

  useEffect(() => {
    const groupGameIdsChanged = previousGroupGameIdsSignature.current !== groupGameIdsSignature
    if (
      optimisticGameIds &&
      (groupGameIdsSignature === confirmedGameIds || groupGameIdsChanged)
    ) {
      setOptimisticGameIds(null)
      setConfirmedGameIds(null)
    }
    previousGroupGameIdsSignature.current = groupGameIdsSignature
  }, [confirmedGameIds, groupGameIdsSignature, optimisticGameIds])

  function updateField<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    if (key === 'name' && nameError) {
      setNameError(null)
    }
  }

  async function handleSave(): Promise<void> {
    const trimmedName = draft.name.trim()
    const trimmedDescription = draft.description.trim()

    if (!trimmedName) {
      setNameError('Enter a group name before saving.')
      return
    }

    try {
      const saved = group
        ? await updateGroupMutation.mutateAsync({
            id: group.id,
            input: {
              name: trimmedName,
              description: trimmedDescription || null,
            },
          })
        : await createGroupMutation.mutateAsync({
            name: trimmedName,
            description: trimmedDescription || null,
          })

      toastSuccess(group ? 'Group updated' : 'Group created', {
        description: saved.name,
        category: 'groups.detail',
      })
      onSaved(saved)
    } catch (err) {
      const details = err instanceof Error ? err.message : String(err)
      toastError(group ? 'Could not update group' : 'Could not create group', {
        description: draft.name.trim() || 'Unnamed group',
        category: 'groups.detail',
        details,
      })
    }
  }

  async function handleDelete(): Promise<void> {
    if (!group) {
      return
    }

    try {
      await deleteGroupMutation.mutateAsync(group.id)
      toastSuccess('Group deleted', {
        description: group.name,
        category: 'groups.detail',
      })
      setDeleteOpen(false)
      onDeleted()
    } catch (err) {
      const details = err instanceof Error ? err.message : String(err)
      toastError('Could not delete group', {
        description: group.name,
        category: 'groups.detail',
        details,
      })
    }
  }

  async function handleScriptIds(nextScriptIds: number[]): Promise<void> {
    if (!group) {
      return
    }

    if (setGroupScriptsMutation.isPending) {
      return
    }

    const previousScriptIds = assignedScriptIds
    setOptimisticScriptIds(nextScriptIds)
    try {
      const savedScriptIds = await setGroupScriptsMutation.mutateAsync({
        groupId: group.id,
        scriptIds: nextScriptIds,
      })
      setOptimisticScriptIds(savedScriptIds)
      setConfirmedScriptIds(buildIdsSignature(savedScriptIds))
    } catch (err) {
      setOptimisticScriptIds(previousScriptIds)
      setConfirmedScriptIds(null)
      const details = err instanceof Error ? err.message : String(err)
      toastError('Could not update group scripts', {
        description: group.name,
        category: 'groups.scripts',
        details,
      })
    }
  }

  async function handleGameIds(nextGameIds: number[]): Promise<void> {
    if (!group) {
      return
    }

    if (setGroupGamesMutation.isPending) {
      return
    }

    const previousGameIds = memberGameIds
    setOptimisticGameIds(nextGameIds)
    try {
      const savedGameIds = await setGroupGamesMutation.mutateAsync({
        groupId: group.id,
        gameIds: nextGameIds,
      })
      setOptimisticGameIds(savedGameIds)
      setConfirmedGameIds(buildIdsSignature(savedGameIds))
    } catch (err) {
      setOptimisticGameIds(previousGameIds)
      setConfirmedGameIds(null)
      const details = err instanceof Error ? err.message : String(err)
      toastError('Could not update group games', {
        description: group.name,
        category: 'groups.games',
        details,
      })
    }
  }

  return (
    <div
      className="mx-auto h-full w-[min(1100px,70%)] overflow-y-auto p-8"
      data-testid="group-detail-panel"
    >
      <div className="flex flex-col gap-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-semibold text-foreground">
              {group ? group.name : 'New group'}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Save the group first, then assign the scripts that should apply to every member game.
            </p>
          </div>
          {group ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Delete group"
              onClick={() => setDeleteOpen(true)}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Icon name="delete" className="text-[18px]" />
            </Button>
          ) : null}
        </header>

        <section className="space-y-4 rounded-2xl border border-border bg-surface-low p-5">
          <div className="space-y-4">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">Name</span>
              <Input
                value={draft.name}
                onChange={(event) => updateField('name', event.target.value)}
                placeholder="HDR Games"
                aria-invalid={nameError ? 'true' : undefined}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">Description</span>
              <Textarea
                value={draft.description}
                onChange={(event) => updateField('description', event.target.value)}
                placeholder="Shared display and capture tweaks"
              />
            </label>
          </div>
          {nameError ? <p className="text-sm text-destructive">{nameError}</p> : null}
          <div className="flex justify-end">
            <Button type="button" onClick={() => void handleSave()} disabled={isPending}>
              <Icon name="save" className="text-[18px]" />
              {group ? 'Save changes' : 'Create group'}
            </Button>
          </div>
        </section>

        {group ? (
          <>
            <GroupScriptAssignment
              scripts={scripts}
              assignedScriptIds={assignedScriptIds}
              disabled={setGroupScriptsMutation.isPending}
              onAssign={(scriptId) => void handleScriptIds([...assignedScriptIds, scriptId])}
              onRemove={(scriptId) =>
                void handleScriptIds(
                  assignedScriptIds.filter((currentId) => currentId !== scriptId)
                )
              }
            />
            <GroupMembers
              games={games}
              memberGameIds={memberGameIds}
              disabled={setGroupGamesMutation.isPending}
              onAssign={(gameId) => void handleGameIds([...memberGameIds, gameId])}
              onRemove={(gameId) =>
                void handleGameIds(memberGameIds.filter((currentId) => currentId !== gameId))
              }
            />
          </>
        ) : (
          <div
            className="rounded-2xl border border-dashed border-border bg-surface-low p-8 text-center"
            data-testid="group-detail-pending-save"
          >
            <Icon name="groups" className="mx-auto text-[32px] text-muted-foreground" />
            <h2 className="mt-3 font-heading text-lg font-semibold text-foreground">
              Save the group to continue
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Script assignment and member game details appear after the group exists.
            </p>
          </div>
        )}
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete group?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the group and its script assignments. Member games stay in the library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>Delete group</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function buildIdsSignature(ids: number[]): string {
  return ids.join(',')
}
