import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  setGroupGames,
  setGroupScripts,
  updateGroup,
  type SaveGroupInput,
} from '@/lib/ipc/groups-commands'
import { GAMES_QUERY_KEY, GROUPS_QUERY_KEY } from '@/lib/queries/query-keys'
import type { Group } from '@/types/domain'

export function groupDetailQueryKey(id: number) {
  return ['group', id] as const
}

/** Load every group. */
export function useGroupsQuery() {
  return useQuery({
    queryKey: GROUPS_QUERY_KEY,
    queryFn: listGroups,
  })
}

/** Load a single group when an id is available. */
export function useGroupQuery(id: number | null | undefined) {
  return useQuery({
    queryKey: groupDetailQueryKey(id ?? -1),
    queryFn: () => getGroup(id as number),
    enabled: typeof id === 'number',
  })
}

function invalidateGroups(queryClient: ReturnType<typeof useQueryClient>, groupId?: number) {
  void queryClient.invalidateQueries({ queryKey: GROUPS_QUERY_KEY })
  if (typeof groupId === 'number') {
    void queryClient.invalidateQueries({ queryKey: groupDetailQueryKey(groupId) })
  }
}

function invalidateDependentGameQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY })
}

function upsertGroup(groups: Group[] | undefined, group: Group): Group[] {
  if (!groups) {
    return [group]
  }
  const index = groups.findIndex((current) => current.id === group.id)
  if (index === -1) {
    return [...groups, group]
  }

  return groups.map((current) => (current.id === group.id ? group : current))
}

/** Create a group and refresh the groups cache. */
export function useCreateGroupMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveGroupInput) => createGroup(input),
    onSuccess: (group: Group) => {
      queryClient.setQueryData<Group[] | undefined>(GROUPS_QUERY_KEY, (current) => upsertGroup(current, group))
      queryClient.setQueryData(groupDetailQueryKey(group.id), group)
      invalidateGroups(queryClient, group.id)
    },
  })
}

/** Update a group and refresh list/detail caches. */
export function useUpdateGroupMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: SaveGroupInput }) => updateGroup(id, input),
    onSuccess: (group: Group) => {
      queryClient.setQueryData<Group[] | undefined>(GROUPS_QUERY_KEY, (current) => upsertGroup(current, group))
      queryClient.setQueryData(groupDetailQueryKey(group.id), group)
      invalidateGroups(queryClient, group.id)
      invalidateDependentGameQueries(queryClient)
    },
  })
}

/** Delete a group and refresh the list cache. */
export function useDeleteGroupMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteGroup(id),
    onSuccess: (_value, id) => {
      queryClient.setQueryData<Group[] | undefined>(GROUPS_QUERY_KEY, (current) =>
        current?.filter((group) => group.id !== id) ?? []
      )
      queryClient.removeQueries({ queryKey: groupDetailQueryKey(id) })
      invalidateGroups(queryClient, id)
      invalidateDependentGameQueries(queryClient)
    },
  })
}

/** Replace a group's script ids and refresh caches. */
export function useSetGroupScriptsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ groupId, scriptIds }: { groupId: number; scriptIds: number[] }) =>
      setGroupScripts(groupId, scriptIds),
    onMutate: async ({ groupId, scriptIds }) => {
      const previousGroups = queryClient.getQueryData<Group[]>(GROUPS_QUERY_KEY)
      const previousGroup = queryClient.getQueryData<Group>(groupDetailQueryKey(groupId))

      queryClient.setQueryData<Group[] | undefined>(GROUPS_QUERY_KEY, (current) =>
        current?.map((group) => (group.id === groupId ? { ...group, scriptIds } : group))
      )
      queryClient.setQueryData<Group | undefined>(groupDetailQueryKey(groupId), (current) =>
        current ? { ...current, scriptIds } : current
      )

      return { previousGroups, previousGroup }
    },
    onError: (_error, { groupId }, context) => {
      if (context?.previousGroups) {
        queryClient.setQueryData(GROUPS_QUERY_KEY, context.previousGroups)
      }
      if (context?.previousGroup) {
        queryClient.setQueryData(groupDetailQueryKey(groupId), context.previousGroup)
      }
    },
    onSuccess: (_scriptIds, { groupId }) => {
      invalidateGroups(queryClient, groupId)
      invalidateDependentGameQueries(queryClient)
    },
  })
}

/** Replace a group's member game ids and refresh caches. */
export function useSetGroupGamesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ groupId, gameIds }: { groupId: number; gameIds: number[] }) =>
      setGroupGames(groupId, gameIds),
    onMutate: async ({ groupId, gameIds }) => {
      const previousGroups = queryClient.getQueryData<Group[]>(GROUPS_QUERY_KEY)
      const previousGroup = queryClient.getQueryData<Group>(groupDetailQueryKey(groupId))

      queryClient.setQueryData<Group[] | undefined>(GROUPS_QUERY_KEY, (current) =>
        current?.map((group) => (group.id === groupId ? { ...group, gameIds } : group))
      )
      queryClient.setQueryData<Group | undefined>(groupDetailQueryKey(groupId), (current) =>
        current ? { ...current, gameIds } : current
      )

      return { previousGroups, previousGroup }
    },
    onError: (_error, { groupId }, context) => {
      if (context?.previousGroups) {
        queryClient.setQueryData(GROUPS_QUERY_KEY, context.previousGroups)
      }
      if (context?.previousGroup) {
        queryClient.setQueryData(groupDetailQueryKey(groupId), context.previousGroup)
      }
    },
    onSuccess: (_gameIds, { groupId }) => {
      invalidateGroups(queryClient, groupId)
      invalidateDependentGameQueries(queryClient)
    },
  })
}
