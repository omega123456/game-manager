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
      <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
        <h2 className="font-heading text-xl font-bold text-foreground">Registered Scripts</h2>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="New"
          onClick={onNew}
          className="h-8 w-8 rounded-full bg-surface-high text-foreground hover:bg-primary hover:text-primary-foreground"
        >
          <Icon name="add" className="text-[20px]" />
        </Button>
      </header>

      <ul className="flex-1 space-y-2 overflow-y-auto p-3" aria-label="Registered scripts">
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
                    'flex w-full cursor-pointer flex-col gap-2 rounded-xl border-2 p-4 text-left transition-colors',
                    active
                      ? 'border-primary bg-surface-container'
                      : 'border-transparent bg-surface hover:bg-surface-container'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        'truncate font-mono text-sm font-medium',
                        active ? 'text-primary' : 'text-foreground'
                      )}
                    >
                      {script.name}
                    </span>
                    <Badge variant={KIND_BADGE[script.kind]}>{KIND_LABEL[script.kind]}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    {isUtility ? (
                      <span aria-label="Priority" className="font-mono text-muted-foreground">
                        –
                      </span>
                    ) : (
                      <span aria-label="Priority" className="inline-flex items-center gap-2">
                        <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-surface-high">
                          <span
                            className="absolute inset-y-0 left-0 rounded-full bg-primary"
                            style={{ width: `${script.priority * 10}%` }}
                          />
                        </span>
                        <span className="font-mono font-semibold text-foreground">
                          {script.priority}
                        </span>
                      </span>
                    )}
                    {isUtility ? null : (
                      <span className="flex items-center gap-1.5">
                        {PHASES.map((phase) => {
                          const enabled = phaseHasContent(script[phase.key])
                          return (
                            <span
                              key={phase.key}
                              aria-label={`${phase.label}: ${enabled ? 'configured' : 'none'}`}
                              className={cn(
                                'h-2 w-2 rounded-full',
                                enabled
                                  ? 'bg-primary'
                                  : 'border border-muted-foreground/40 bg-transparent'
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
