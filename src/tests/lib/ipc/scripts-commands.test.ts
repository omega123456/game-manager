import { describe, expect, it } from 'vitest'

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
import type { Script } from '@/types/domain'

import { ipc } from '../../ipc-mock'

const NONE = { mode: 'none' as const }

const UTILITY: Script = {
  id: 3,
  name: 'SaveLib',
  kind: 'utility',
  priority: 5,
  beforeLaunch: NONE,
  afterLaunch: NONE,
  onExit: NONE,
  snippet: { mode: 'inline', inline: 'function Save {}', interpreter: 'powershell' },
  createdAt: '2026-01-03T00:00:00Z',
  requires: [],
}

const NORMAL_INPUT: SaveScriptInput = {
  name: 'Auto-Save',
  kind: 'normal',
  priority: 7,
  beforeLaunch: { mode: 'inline', inline: 'Write-Host hi', interpreter: 'powershell' },
}

describe('scripts-commands', () => {
  it('lists scripts', async () => {
    ipc.override('list_scripts', () => [UTILITY])
    await expect(listScripts()).resolves.toEqual([UTILITY])
    expect(ipc.calls('list_scripts')).toHaveLength(1)
  })

  it('gets a single script by id', async () => {
    ipc.override('get_script', (args) => ({ ...UTILITY, id: args?.id }))
    await expect(getScript(3)).resolves.toMatchObject({ id: 3 })
    expect(ipc.calls('get_script')).toEqual([{ id: 3 }])
  })

  it('creates a script forwarding the input payload', async () => {
    ipc.override('create_script', (args) => ({ ...UTILITY, ...(args?.input as object) }))
    await createScript(NORMAL_INPUT)
    expect(ipc.calls('create_script')).toEqual([{ input: NORMAL_INPUT }])
  })

  it('updates a script with id + input', async () => {
    ipc.override('update_script', (args) => ({
      ...UTILITY,
      id: args?.id,
      ...((args?.input as object) ?? {}),
    }))
    await updateScript(5, NORMAL_INPUT)
    expect(ipc.calls('update_script')).toEqual([{ id: 5, input: NORMAL_INPUT }])
  })

  it('deletes a script', async () => {
    await deleteScript(8)
    expect(ipc.calls('delete_script')).toEqual([{ id: 8 }])
  })

  it('sets dependencies forwarding scriptId + dependsOn', async () => {
    ipc.override('set_script_dependencies', (args) => args?.dependsOn ?? [])
    await expect(setScriptDependencies(2, [3, 4])).resolves.toEqual([3, 4])
    expect(ipc.calls('set_script_dependencies')).toEqual([{ scriptId: 2, dependsOn: [3, 4] }])
  })

  it('sets the script kind', async () => {
    ipc.override('set_script_kind', (args) => ({ ...UTILITY, id: args?.id, kind: args?.kind }))
    await expect(setScriptKind(3, 'global')).resolves.toMatchObject({ kind: 'global' })
    expect(ipc.calls('set_script_kind')).toEqual([{ id: 3, kind: 'global' }])
  })
})
