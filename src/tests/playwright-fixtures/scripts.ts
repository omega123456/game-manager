import type { Script } from '@/types/domain'

import type { PlaywrightFixtureHandler } from './index'

const NONE = { mode: 'none' } as const

export const SCRIPT_ROWS: Script[] = [
  {
    id: 1,
    name: 'HDR Toggle',
    description: 'Enables HDR before launch and restores on exit.',
    kind: 'global',
    priority: 8,
    beforeLaunch: { mode: 'inline', inline: 'Enable-HDR', interpreter: 'powershell' },
    afterLaunch: NONE,
    onExit: { mode: 'inline', inline: 'Disable-HDR', interpreter: 'powershell' },
    snippet: NONE,
    createdAt: '2026-01-01T00:00:00Z',
    requires: [3],
  },
  {
    id: 2,
    name: 'Auto-Save Manager',
    kind: 'normal',
    priority: 7,
    beforeLaunch: { mode: 'path', path: 'C:/Commands/autosave.ps1' },
    afterLaunch: NONE,
    onExit: NONE,
    snippet: NONE,
    createdAt: '2026-01-02T00:00:00Z',
    requires: [3],
  },
  {
    id: 4,
    name: 'Gamma Sweep',
    kind: 'normal',
    priority: 6,
    beforeLaunch: { mode: 'inline', inline: 'Run-Gamma', interpreter: 'powershell' },
    afterLaunch: NONE,
    onExit: NONE,
    snippet: NONE,
    createdAt: '2026-01-05T00:00:00Z',
    requires: [],
  },
  {
    id: 3,
    name: 'SaveLib',
    description: 'Shared helper functions.',
    kind: 'utility',
    priority: 5,
    beforeLaunch: NONE,
    afterLaunch: NONE,
    onExit: NONE,
    snippet: { mode: 'inline', inline: 'function Save-State {}', interpreter: 'powershell' },
    createdAt: '2026-01-03T00:00:00Z',
    requires: [],
  },
]

export const scriptsFixtures: Record<string, PlaywrightFixtureHandler> = {
  list_scripts: () => SCRIPT_ROWS,
  get_script: (args) => SCRIPT_ROWS.find((script) => script.id === args?.id) ?? null,
  create_script: (args) => ({
    id: 99,
    createdAt: '2026-01-04T00:00:00Z',
    requires: [],
    ...(args?.input as object),
  }),
  update_script: (args) => ({
    id: args?.id ?? 1,
    createdAt: '2026-01-01T00:00:00Z',
    requires: [],
    ...(args?.input as object),
  }),
  delete_script: () => undefined,
  set_script_dependencies: (args) => args?.dependsOn ?? [],
  set_script_kind: (args) => {
    const existing = SCRIPT_ROWS.find((script) => script.id === args?.id) ?? SCRIPT_ROWS[0]
    return { ...existing, kind: args?.kind }
  },
}
