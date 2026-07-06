/**
 * Shared domain DTOs and enums — the TypeScript mirror of the Rust types in
 * `src-tauri/src/domain/mod.rs`. All shapes are camelCase to match the
 * `#[serde(rename_all = "camelCase")]` IPC serialization. Keep this file in
 * lock-step with the Rust domain module.
 */

/** Process-monitoring strategy for a game. */
export type MonitorMode = 'tree' | 'named'

/** The mutually-exclusive kind of a script. */
export type ScriptKind = 'normal' | 'utility' | 'global'

/** How a phase (or utility snippet) is sourced. */
export type PhaseMode = 'none' | 'path' | 'inline'

/** Interpreter for inline code. */
export type Interpreter = 'powershell' | 'powershell7' | 'batch'

/** Severity level for an application log row. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** A phase in the launch lifecycle (event payload phase). */
export type LaunchPhase = 'before' | 'waitingForProcess' | 'playing' | 'onExit' | 'ended'

/** Durable lifecycle status of a persisted launch run. */
export type LaunchRunStatus = 'active' | 'completed' | 'cancelled' | 'incomplete'

/** One of the three executable script phases used by the resolver/executor. */
export type ScriptPhase = 'before' | 'after' | 'onExit'

/** Provenance of a resolved script entry. */
export type Provenance = 'global' | 'group' | 'direct'

/** Status of one persisted script-execution row in a launch run. */
export type ScriptExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'notReached'

/** Provider/source for art candidates and metadata suggestions. */
export type ArtSource = 'steamGridDb' | 'steam' | 'input'

/** One configured phase of a normal/global script (or a utility snippet). */
export interface PhaseConfig {
  mode: PhaseMode
  path?: string
  inline?: string
  interpreter?: Interpreter
}

/** A game in the library, including computed playtime aggregates. */
export interface Game {
  id: number
  name: string
  launchTarget: string
  monitorMode: MonitorMode
  monitorProcessName?: string
  arguments?: string
  imagePath?: string
  groupIds: number[]
  scriptIds: number[]
  createdAt: string
  totalPlaytimeSeconds: number
  lastPlayedAt?: string
}

/** A script: normal/global (phases + priority) or utility (single snippet). */
export interface Script {
  id: number
  name: string
  description?: string
  kind: ScriptKind
  priority: number
  beforeLaunch: PhaseConfig
  afterLaunch: PhaseConfig
  onExit: PhaseConfig
  snippet: PhaseConfig
  createdAt: string
  /** Ids of required utility scripts (require/include edges). */
  requires: number[]
}

/** A group of games sharing assigned scripts. */
export interface Group {
  id: number
  name: string
  description?: string
  scriptIds: number[]
  gameIds: number[]
}

/** A single tracked play session. */
export interface PlaySession {
  id: number
  gameId: number
  startedAt: string
  endedAt?: string
}

/** A resolved script entry within a phase (resolver output / preview). */
export interface ResolvedScript {
  scriptId: number
  name: string
  priority: number
  phase: ScriptPhase
  provenance: Provenance
  groupName?: string
  /** 1-based order within the phase. */
  order: number
  requiredUtilityNames: string[]
}

/** A selectable cover-art candidate for the Add Game flow. */
export interface ArtCandidate {
  id: string
  imageUrl: string
  source: ArtSource
  width: number
  height: number
  providerName: string
}

/** Metadata autofill result for the Add Game flow. */
export interface MetadataResult {
  canonicalName: string
  source: ArtSource
}

/** Launch lifecycle event payload (emitted on `launch://*`). */
export interface LaunchLifecycle {
  gameId: number
  /**
   * The durable launch run this event belongs to. Absent only for a terminal
   * failure emitted before any run row was created. Used to tell apart a
   * stale event from an earlier run of the same game (e.g. a rapid relaunch)
   * from the current one.
   */
  runId?: number
  phase: LaunchPhase
  detail?: string
  failedCount: number
  elapsedSeconds?: number
}

/** One persisted script row within a durable launch run. */
export interface LaunchScriptRecord {
  id: number
  launchRunId: number
  scriptId?: number
  name: string
  phase: ScriptPhase
  provenance: Provenance
  groupName?: string
  /** 1-based order within the phase. */
  order: number
  priority: number
  requiredUtilityNames: string[]
  status: ScriptExecutionStatus
  startedAt?: string
  endedAt?: string
  details?: string
}

/** The latest retained durable launch run for one game. */
export interface LaunchRun {
  id: number
  gameId: number
  playSessionId?: number
  status: LaunchRunStatus
  startedAt: string
  endedAt?: string
  failureCount: number
  scriptRecords: LaunchScriptRecord[]
}

/** Payload emitted after each committed script-execution ledger write. */
export interface ScriptExecutionUpdated {
  gameId: number
  launchRunId: number
}

/** An application log row. */
export interface LogEntry {
  id: number
  ts: string
  level: LogLevel
  category: string
  message: string
  gameId?: number
  scriptId?: number
  details?: string
}

/** A single page of log rows plus the bounded total used to drive pagination. */
export interface LogPage {
  entries: LogEntry[]
  /** Total rows across all pages (bounded by the backend window). */
  total: number
  /** The 1-based page number these entries belong to. */
  page: number
  /** Rows per page. */
  pageSize: number
}
