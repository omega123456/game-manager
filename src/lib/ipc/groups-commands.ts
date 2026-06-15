import { invoke } from '@tauri-apps/api/core'

import type { Group } from '@/types/domain'

export interface SaveGroupInput {
  name: string
  description?: string | null
}

/** Read every group with assigned scripts and member games. */
export function listGroups(): Promise<Group[]> {
  return invoke<Group[]>('list_groups')
}

/** Read a single group by id. */
export function getGroup(id: number): Promise<Group> {
  return invoke<Group>('get_group', { id })
}

/** Create a group and return the hydrated row. */
export function createGroup(input: SaveGroupInput): Promise<Group> {
  return invoke<Group>('create_group', { input })
}

/** Update a group and return the hydrated row. */
export function updateGroup(id: number, input: SaveGroupInput): Promise<Group> {
  return invoke<Group>('update_group', { id, input })
}

/** Delete a group by id. */
export function deleteGroup(id: number): Promise<void> {
  return invoke<void>('delete_group', { id })
}

/** Replace the set of assigned normal scripts for a group. */
export function setGroupScripts(groupId: number, scriptIds: number[]): Promise<number[]> {
  return invoke<number[]>('set_group_scripts', { groupId, scriptIds })
}
