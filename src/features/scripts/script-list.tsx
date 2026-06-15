import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import type { Script } from '@/types/domain'

import { KIND_LABEL, PHASES, phaseHasContent } from './script-form-types'

export interface ScriptListProps {
  scripts: Script[]
  /** Id of the active/selected script (null when creating a new one). */
  selectedId: number | null
  onSelect: (scriptId: number) => void
  onNew: () => void
}

const KIND_BADGE: Record<Script['kind'], 'default' | 'secondary' | 'muted'> = {
  global: 'default',
  utility: 'secondary',
  normal: 'muted',
}

/** Left-hand list of registered scripts with a "+ New" action. */
export function ScriptList({
  scripts,
  selectedId,
  onSelect,
  onNew,
}: ScriptListProps): React.JSX.Element {
  return (
    <div className="flex h-full flex-col border-r border-border bg-surface-low">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="font-heading text-sm font-semibold text-foreground">Registered Scripts</h2>
        <Button type="button" size="sm" variant="outline" onClick={onNew}>
          <Icon name="add" className="text-[18px]" />
          New
        </Button>
      </header>

      <ul className="flex-1 overflow-y-auto p-2" aria-label="Registered scripts">
        {scripts.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">
            No scripts yet. Create one to get started.
          </li>
        ) : (
          scripts.map((script) => {
            const active = script.id === selectedId
            const isUtility = script.kind === 'utility'
            return (
              <li key={script.id}>
                <button
                  type="button"
                  onClick={() => onSelect(script.id)}
                  aria-label={`Edit ${script.name}`}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                    active
                      ? 'border-primary/30 bg-primary/10'
                      : 'border-transparent hover:bg-surface-high'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-sm text-foreground">
                      {script.name}
                    </span>
                    <Badge variant={KIND_BADGE[script.kind]}>{KIND_LABEL[script.kind]}</Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="font-mono" aria-label="Priority">
                      {isUtility ? '–' : script.priority}
                    </span>
                    {isUtility ? null : (
                      <span className="flex items-center gap-1.5">
                        {PHASES.map((phase) => {
                          const enabled = phaseHasContent(script[phase.key])
                          return (
                            <Icon
                              key={phase.key}
                              name={phase.icon}
                              aria-label={`${phase.label}: ${enabled ? 'configured' : 'none'}`}
                              className={cn(
                                'text-[16px]',
                                enabled ? 'text-foreground' : 'text-muted-foreground/30'
                              )}
                            />
                          )
                        })}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
