import type { Interpreter, PhaseConfig, Script, ScriptKind } from '@/types/domain'

/** The three lifecycle phases of a normal/global script. */
export type PhaseKey = 'beforeLaunch' | 'afterLaunch' | 'onExit'

export interface PhaseMeta {
  key: PhaseKey
  label: string
  /** Material Symbols glyph used in list rows + phase headers. */
  icon: string
}

/** Material Symbols glyph per editor phase key — shared with launch execution UI. */
export const PHASE_ICONS = {
  beforeLaunch: 'play_arrow',
  afterLaunch: 'bolt',
  onExit: 'logout',
} as const satisfies Record<PhaseKey, string>

/** Phase metadata in execution order, used by both the editor and the list. */
export const PHASES: readonly PhaseMeta[] = [
  { key: 'beforeLaunch', label: 'Before Launch', icon: PHASE_ICONS.beforeLaunch },
  { key: 'afterLaunch', label: 'After Process Detected', icon: PHASE_ICONS.afterLaunch },
  { key: 'onExit', label: 'On Exit', icon: PHASE_ICONS.onExit },
] as const

/** Human-readable label for a script kind. */
export const KIND_LABEL: Record<ScriptKind, string> = {
  normal: 'Normal',
  utility: 'Utility',
  global: 'Global',
}

/** Single-select kind options in display order. */
export const KIND_OPTIONS: readonly { value: ScriptKind; label: string; description: string }[] = [
  { value: 'normal', label: 'Normal', description: 'Per-game / group, runs across the 3 phases.' },
  { value: 'global', label: 'Global', description: 'Runs for every game automatically.' },
  { value: 'utility', label: 'Utility', description: 'A reusable snippet other scripts require.' },
] as const

export const MIN_PRIORITY = 1
export const MAX_PRIORITY = 10
export const DEFAULT_PRIORITY = 5

export type PriorityTier = 'low' | 'medium' | 'high'

/** Maps a 1–10 priority to a tier; higher numbers mean higher priority. */
export function priorityTier(priority: number): PriorityTier {
  if (priority <= 3) {
    return 'low'
  }
  if (priority <= 7) {
    return 'medium'
  }
  return 'high'
}

/** An empty (mode `none`) phase config. */
export function emptyPhase(): PhaseConfig {
  return { mode: 'none' }
}

/** True when a phase/snippet has content to run. */
export function phaseHasContent(phase: PhaseConfig | undefined): boolean {
  if (!phase) {
    return false
  }
  if (phase.mode === 'path') {
    return Boolean(phase.path?.trim())
  }
  if (phase.mode === 'inline') {
    return Boolean(phase.inline?.trim())
  }
  return false
}

/** Default interpreter applied when a phase first switches into `inline`/`path`. */
export function defaultInterpreter(phase: PhaseConfig): Interpreter {
  return phase.interpreter ?? 'powershell'
}

export interface ScriptDraft {
  name: string
  description: string
  kind: ScriptKind
  priority: number
  beforeLaunch: PhaseConfig
  afterLaunch: PhaseConfig
  onExit: PhaseConfig
  snippet: PhaseConfig
}

/** Build an editable draft for a new script. */
export function newScriptDraft(): ScriptDraft {
  return {
    name: '',
    description: '',
    kind: 'normal',
    priority: DEFAULT_PRIORITY,
    beforeLaunch: emptyPhase(),
    afterLaunch: emptyPhase(),
    onExit: emptyPhase(),
    snippet: emptyPhase(),
  }
}

/**
 * Preview whether adding a require edge `from -> candidate` would create a
 * cycle, by walking the candidate's transitive require edges and checking
 * whether it can reach `from`. The backend is authoritative; this only powers
 * the disabled-state preview in the picker.
 */
export function wouldCreateCycle(from: number, candidate: number, allScripts: Script[]): boolean {
  if (from === candidate) {
    return true
  }
  const requiresById = new Map(allScripts.map((s) => [s.id, s.requires]))
  const seen = new Set<number>()
  const stack = [candidate]
  while (stack.length > 0) {
    const current = stack.pop() as number
    if (current === from) {
      return true
    }
    if (seen.has(current)) {
      continue
    }
    seen.add(current)
    for (const next of requiresById.get(current) ?? []) {
      stack.push(next)
    }
  }
  return false
}

/** Build an editable draft from a persisted script. */
export function draftFromScript(script: Script): ScriptDraft {
  return {
    name: script.name,
    description: script.description ?? '',
    kind: script.kind,
    priority: script.priority,
    beforeLaunch: { ...script.beforeLaunch },
    afterLaunch: { ...script.afterLaunch },
    onExit: { ...script.onExit },
    snippet: { ...script.snippet },
  }
}
