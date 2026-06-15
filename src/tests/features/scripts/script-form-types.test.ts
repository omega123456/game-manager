import { describe, expect, it } from 'vitest'

import type { Script } from '@/types/domain'
import {
  draftFromScript,
  emptyPhase,
  newScriptDraft,
  phaseHasContent,
  wouldCreateCycle,
} from '@/features/scripts/script-form-types'

const UTILITY: Script = {
  id: 3,
  name: 'SaveLib',
  kind: 'utility',
  priority: 5,
  beforeLaunch: emptyPhase(),
  afterLaunch: emptyPhase(),
  onExit: emptyPhase(),
  snippet: { mode: 'inline', inline: 'function f {}', interpreter: 'powershell' },
  createdAt: '2026-01-01T00:00:00Z',
  requires: [],
}

describe('phaseHasContent', () => {
  it('treats none and blank values as empty', () => {
    expect(phaseHasContent(undefined)).toBe(false)
    expect(phaseHasContent({ mode: 'none' })).toBe(false)
    expect(phaseHasContent({ mode: 'path', path: '   ' })).toBe(false)
    expect(phaseHasContent({ mode: 'inline', inline: '' })).toBe(false)
  })

  it('treats non-blank path/inline as content', () => {
    expect(phaseHasContent({ mode: 'path', path: 'a.ps1' })).toBe(true)
    expect(phaseHasContent({ mode: 'inline', inline: 'echo' })).toBe(true)
  })
})

describe('drafts', () => {
  it('creates a normal default draft', () => {
    const draft = newScriptDraft()
    expect(draft.kind).toBe('normal')
    expect(draft.priority).toBe(5)
    expect(draft.beforeLaunch.mode).toBe('none')
  })

  it('copies a persisted script into a draft', () => {
    const draft = draftFromScript(UTILITY)
    expect(draft.name).toBe('SaveLib')
    expect(draft.snippet.inline).toBe('function f {}')
    // Mutating the draft must not affect the source.
    draft.snippet.inline = 'changed'
    expect(UTILITY.snippet.inline).toBe('function f {}')
  })
})

describe('wouldCreateCycle', () => {
  function util(id: number, requires: number[]): Script {
    return {
      id,
      name: `u${id}`,
      kind: 'utility',
      priority: 5,
      beforeLaunch: emptyPhase(),
      afterLaunch: emptyPhase(),
      onExit: emptyPhase(),
      snippet: emptyPhase(),
      createdAt: '2026-01-01T00:00:00Z',
      requires,
    }
  }

  // Graph: 1 -> 2 -> 3.
  const scripts: Script[] = [util(1, [2]), util(2, [3]), util(3, [])]

  it('flags self-references', () => {
    expect(wouldCreateCycle(1, 1, scripts)).toBe(true)
  })

  it('flags transitive cycles', () => {
    // Adding 1 -> 3 is fine; adding 3 -> 1 would close the loop 1->2->3->1.
    expect(wouldCreateCycle(3, 1, scripts)).toBe(true)
    expect(wouldCreateCycle(1, 3, scripts)).toBe(false)
  })

  it('returns false when no path back exists', () => {
    expect(wouldCreateCycle(1, 4, scripts)).toBe(false)
  })
})
