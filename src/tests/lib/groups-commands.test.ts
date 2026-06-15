import { describe, expect, it } from 'vitest'

import {
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  setGroupScripts,
  updateGroup,
} from '@/lib/ipc/groups-commands'
import type { Group } from '@/types/domain'

import { ipc } from '../ipc-mock'

const GROUP_ROW: Group = {
  id: 7,
  name: 'HDR Games',
  description: 'Shared HDR setup',
  scriptIds: [3],
  gameIds: [1, 4],
}

describe('groups-commands', () => {
  it('lists groups', async () => {
    ipc.override('list_groups', () => [GROUP_ROW])
    await expect(listGroups()).resolves.toEqual([GROUP_ROW])
    expect(ipc.calls('list_groups')).toHaveLength(1)
  })

  it('gets a single group by id', async () => {
    ipc.override('get_group', (args) => ({ ...GROUP_ROW, id: args?.id }))
    await expect(getGroup(42)).resolves.toMatchObject({ id: 42 })
    expect(ipc.calls('get_group')).toEqual([{ id: 42 }])
  })

  it('creates a group forwarding the wrapped input payload', async () => {
    const input = { name: 'Launchers', description: 'Store launcher scripts' }
    ipc.override('create_group', (args) => ({ ...GROUP_ROW, ...(args?.input as object) }))
    await expect(createGroup(input)).resolves.toMatchObject(input)
    expect(ipc.calls('create_group')).toEqual([{ input }])
  })

  it('updates a group with id + input', async () => {
    const input = { name: 'Deck Verified', description: 'Handheld-friendly tweaks' }
    ipc.override('update_group', (args) => ({
      ...GROUP_ROW,
      id: args?.id,
      ...((args?.input as object) ?? {}),
    }))
    await expect(updateGroup(5, input)).resolves.toMatchObject({ id: 5, ...input })
    expect(ipc.calls('update_group')).toEqual([{ id: 5, input }])
  })

  it('deletes a group by id', async () => {
    await expect(deleteGroup(8)).resolves.toBeUndefined()
    expect(ipc.calls('delete_group')).toEqual([{ id: 8 }])
  })

  it('replaces group scripts', async () => {
    ipc.override('set_group_scripts', () => [11, 12])
    await expect(setGroupScripts(3, [12, 11])).resolves.toEqual([11, 12])
    expect(ipc.calls('set_group_scripts')).toEqual([{ groupId: 3, scriptIds: [12, 11] }])
  })
})
