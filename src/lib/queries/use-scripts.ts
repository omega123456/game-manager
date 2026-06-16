import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createScript,
  deleteScript,
  getScript,
  listScripts,
  setScriptDependencies,
  setScriptKind,
  updateScript,
  type SaveScriptInput,
} from '@/lib/ipc/scripts-commands'
import { GAMES_QUERY_KEY, GROUPS_QUERY_KEY } from '@/lib/queries/query-keys'
import type { Script, ScriptKind } from '@/types/domain'

export const SCRIPTS_QUERY_KEY = ['scripts'] as const

export function scriptDetailQueryKey(id: number) {
  return ['script', id] as const
}

/** Load every script. */
export function useScriptsQuery() {
  return useQuery({
    queryKey: SCRIPTS_QUERY_KEY,
    queryFn: listScripts,
  })
}

/** Load a single script when an id is available. */
export function useScriptQuery(id: number | null | undefined) {
  return useQuery({
    queryKey: scriptDetailQueryKey(id ?? -1),
    queryFn: () => getScript(id as number),
    enabled: typeof id === 'number',
  })
}

function invalidateScripts(queryClient: ReturnType<typeof useQueryClient>, scriptId?: number) {
  void queryClient.invalidateQueries({ queryKey: SCRIPTS_QUERY_KEY })
  if (typeof scriptId === 'number') {
    void queryClient.invalidateQueries({ queryKey: scriptDetailQueryKey(scriptId) })
  }
}

/** Create a script and refresh the scripts cache. */
export function useCreateScriptMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveScriptInput) => createScript(input),
    onSuccess: (script: Script) => {
      invalidateScripts(queryClient, script.id)
    },
  })
}

/** Update a script and refresh list/detail caches. */
export function useUpdateScriptMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: SaveScriptInput }) => updateScript(id, input),
    onSuccess: (script: Script) => {
      invalidateScripts(queryClient, script.id)
    },
  })
}

/** Delete a script and refresh the list cache. */
export function useDeleteScriptMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteScript(id),
    onSuccess: (_value, id) => {
      invalidateScripts(queryClient, id)
      // The DB cascade removes the script's game_scripts/group_scripts rows;
      // refresh games and groups so their assignment lists drop it.
      void queryClient.invalidateQueries({ queryKey: GAMES_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: GROUPS_QUERY_KEY })
    },
  })
}

/** Replace a script's require edges and refresh caches. */
export function useSetScriptDependenciesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ scriptId, dependsOn }: { scriptId: number; dependsOn: number[] }) =>
      setScriptDependencies(scriptId, dependsOn),
    onSuccess: (_dependsOn, { scriptId }) => {
      invalidateScripts(queryClient, scriptId)
    },
  })
}

/** Change a script's kind and refresh caches. */
export function useSetScriptKindMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, kind }: { id: number; kind: ScriptKind }) => setScriptKind(id, kind),
    onSuccess: (script: Script) => {
      invalidateScripts(queryClient, script.id)
    },
  })
}
