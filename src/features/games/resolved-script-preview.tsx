import { Badge } from '@/components/ui/badge'
import { Icon } from '@/components/ui/icon'
import type { ResolvedScript, ScriptPhase } from '@/types/domain'

const PHASE_META: Record<ScriptPhase, { title: string; icon: string; testId: string }> = {
  before: { title: 'Before launch', icon: 'schedule', testId: 'resolved-phase-before' },
  after: { title: 'After process detected', icon: 'bolt', testId: 'resolved-phase-after' },
  onExit: { title: 'On exit', icon: 'logout', testId: 'resolved-phase-on-exit' },
}

function provenanceLabel(script: ResolvedScript): string {
  switch (script.provenance) {
    case 'direct':
      return 'Direct'
    case 'group':
      return script.groupName ? `Group: ${script.groupName}` : 'Group'
    case 'global':
    default:
      return 'Global'
  }
}

export interface ResolvedScriptPreviewProps {
  scripts: ResolvedScript[]
}

export function ResolvedScriptPreview({ scripts }: ResolvedScriptPreviewProps): React.JSX.Element {
  return (
    <section className="space-y-4 rounded-[1.5rem] border border-border bg-surface-low p-5" data-testid="resolved-script-preview">
      <div>
        <h3 className="font-heading text-base font-semibold text-foreground">Resolved execution order</h3>
        <p className="text-sm text-muted-foreground">
          Direct assignments outrank group inheritance, which outranks global scripts. Utilities stay nested inside entries.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {(['before', 'after', 'onExit'] as const).map((phase) => {
          const phaseScripts = scripts.filter((script) => script.phase === phase)
          return (
            <section
              key={phase}
              className="space-y-3 rounded-[1.25rem] border border-border bg-background/70 p-4"
              data-testid={PHASE_META[phase].testId}
            >
              <div className="flex items-center gap-2">
                <Icon name={PHASE_META[phase].icon} className="text-[18px] text-primary" />
                <h4 className="text-sm font-semibold text-foreground">{PHASE_META[phase].title}</h4>
              </div>

              {phaseScripts.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-3 py-5 text-sm text-muted-foreground">
                  No scripts run in this phase.
                </p>
              ) : (
                <div className="space-y-3">
                  {phaseScripts.map((script) => (
                    <article key={`${phase}-${script.scriptId}`} className="rounded-xl border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{script.name}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                            Priority {script.priority}
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          #{script.order}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="muted">{provenanceLabel(script)}</Badge>
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">
                        {script.requiredUtilityNames.length > 0
                          ? `Requires: ${script.requiredUtilityNames.join(', ')}`
                          : 'Requires: none'}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </section>
  )
}
