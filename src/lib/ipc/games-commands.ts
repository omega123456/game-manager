import { invoke } from '@tauri-apps/api/core'

import type { Game, MonitorMode } from '@/types/domain'

export interface SaveGameInput {
  name: string
  launchTarget: string
  monitorMode: MonitorMode
  monitorProcessName?: string | null
  arguments?: string | null
  imagePath?: string | null
}

/** Read every game with computed playtime aggregates. */
export function listGames(): Promise<Game[]> {
  return invoke<Game[]>('list_games')
}

/** Read a single game by id. */
export function getGame(id: number): Promise<Game> {
  return invoke<Game>('get_game', { id })
}

/** Create a game and return the hydrated row. */
export function createGame(input: SaveGameInput): Promise<Game> {
  return invoke<Game>('create_game', { input })
}

/** Update a game and return the hydrated row. */
export function updateGame(id: number, input: SaveGameInput): Promise<Game> {
  return invoke<Game>('update_game', { id, input })
}

/** Delete a game by id. */
export function deleteGame(id: number): Promise<void> {
  return invoke<void>('delete_game', { id })
}

/** Replace the set of groups a game belongs to. */
export function setGameGroups(gameId: number, groupIds: number[]): Promise<number[]> {
  return invoke<number[]>('set_game_groups', { gameId, groupIds })
}

/** Replace the set of directly assigned normal scripts for a game. */
export function setGameScripts(gameId: number, scriptIds: number[]): Promise<number[]> {
  return invoke<number[]>('set_game_scripts', { gameId, scriptIds })
}
