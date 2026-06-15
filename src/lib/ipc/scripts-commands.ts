import { invoke } from '@tauri-apps/api/core'

import type { PhaseConfig, Script, ScriptKind } from '@/types/domain'

/** Create/update payload for a script (the active column-group depends on `kind`). */
export interface SaveScriptInput {
  name: string
  description?: string | null
  kind: ScriptKind
  priority: number
  beforeLaunch?: PhaseConfig
  afterLaunch?: PhaseConfig
  onExit?: PhaseConfig
  snippet?: PhaseConfig
}

/** Read every script with its `requires` edges populated. */
export function listScripts(): Promise<Script[]> {
  return invoke<Script[]>('list_scripts')
}

/** Read a single script by id. */
export function getScript(id: number): Promise<Script> {
  return invoke<Script>('get_script', { id })
}

/** Create a script and return the hydrated row. */
export function createScript(input: SaveScriptInput): Promise<Script> {
  return invoke<Script>('create_script', { input })
}

/** Update a script and return the hydrated row. */
export function updateScript(id: number, input: SaveScriptInput): Promise<Script> {
  return invoke<Script>('update_script', { id, input })
}

/** Delete a script by id. */
export function deleteScript(id: number): Promise<void> {
  return invoke<void>('delete_script', { id })
}

/**
 * Replace a script's require edges. The backend validates that every target is a
 * utility script and rejects cycles; returns the persisted require ids.
 */
export function setScriptDependencies(scriptId: number, dependsOn: number[]): Promise<number[]> {
  return invoke<number[]>('set_script_dependencies', { scriptId, dependsOn })
}

/** Change a script's kind and return the hydrated row. */
export function setScriptKind(id: number, kind: ScriptKind): Promise<Script> {
  return invoke<Script>('set_script_kind', { id, kind })
}
