import { describe, expect, it } from 'vitest'

import {
  createGame,
  deleteGame,
  getGame,
  getLatestLaunchRun,
  getResolvedScripts,
  listGames,
  setGameGroups,
  setGameScripts,
  updateGame,
} from '@/lib/ipc/games-commands'
import { ipc } from '../ipc-mock'

const GAME_ROW = {
  id: 7,
  name: 'Elden Ring',
  launchTarget: 'C:/Games/EldenRing.exe',
  monitorMode: 'tree' as const,
  groupIds: [],
  scriptIds: [],
  createdAt: '2026-01-01T00:00:00Z',
  totalPlaytimeSeconds: 3600,
}

describe('games-commands', () => {
  it('lists games', async () => {
    ipc.override('list_games', () => [GAME_ROW])
    await expect(listGames()).resolves.toEqual([GAME_ROW])
  })

  it('gets a single game by id', async () => {
    ipc.override('get_game', (args) => ({ ...GAME_ROW, id: args?.id }))
    await expect(getGame(42)).resolves.toMatchObject({ id: 42 })
    expect(ipc.calls('get_game')).toEqual([{ id: 42 }])
  })

  it('creates a game with the wrapped input payload', async () => {
    ipc.override('create_game', (args) => ({ ...GAME_ROW, ...(args?.input as object) }))
    const input = {
      name: 'Control',
      launchTarget: 'C:/Games/Control.exe',
      monitorMode: 'named' as const,
      monitorProcessName: 'control.exe',
      arguments: '-dx12',
      imagePath: 'C:/Art/control.png',
    }
    await expect(createGame(input)).resolves.toMatchObject(input)
    expect(ipc.calls('create_game')).toEqual([{ input }])
  })

  it('updates a game with id and input', async () => {
    ipc.override('update_game', (args) => ({
      ...GAME_ROW,
      id: args?.id,
      ...((args?.input as object) ?? {}),
    }))
    const input = {
      name: 'Control Ultimate Edition',
      launchTarget: 'C:/Games/Control.exe',
      monitorMode: 'tree' as const,
    }
    await expect(updateGame(9, input)).resolves.toMatchObject({ id: 9, ...input })
    expect(ipc.calls('update_game')).toEqual([{ id: 9, input }])
  })

  it('deletes a game by id', async () => {
    await expect(deleteGame(5)).resolves.toBeUndefined()
    expect(ipc.calls('delete_game')).toEqual([{ id: 5 }])
  })

  it('replaces game groups', async () => {
    ipc.override('set_game_groups', () => [2, 4])
    await expect(setGameGroups(8, [4, 2])).resolves.toEqual([2, 4])
    expect(ipc.calls('set_game_groups')).toEqual([{ gameId: 8, groupIds: [4, 2] }])
  })

  it('replaces game scripts', async () => {
    ipc.override('set_game_scripts', () => [11])
    await expect(setGameScripts(8, [11])).resolves.toEqual([11])
    expect(ipc.calls('set_game_scripts')).toEqual([{ gameId: 8, scriptIds: [11] }])
  })

  it('loads resolved scripts for a game', async () => {
    ipc.override('get_resolved_scripts', () => [{ scriptId: 11, phase: 'before' }])
    await expect(getResolvedScripts(8)).resolves.toEqual([{ scriptId: 11, phase: 'before' }])
    expect(ipc.calls('get_resolved_scripts')).toEqual([{ gameId: 8 }])
  })

  it('loads the latest retained launch run for a game', async () => {
    ipc.override('get_latest_launch_run', () => ({
      id: 12,
      gameId: 8,
      status: 'completed',
      startedAt: '2026-06-19T10:00:00Z',
      endedAt: '2026-06-19T10:01:00Z',
      failureCount: 1,
      scriptRecords: [],
    }))
    await expect(getLatestLaunchRun(8)).resolves.toMatchObject({
      id: 12,
      gameId: 8,
      failureCount: 1,
    })
    expect(ipc.calls('get_latest_launch_run')).toEqual([{ gameId: 8 }])
  })
})
