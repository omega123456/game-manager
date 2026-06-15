import { Icon } from '@/components/ui/icon'
import { Switch } from '@/components/ui/switch'
import { toastError } from '@/lib/app-log-commands'
import { useScriptsQuery, useSetScriptKindMutation } from '@/lib/queries/use-scripts'
import type { Script } from '@/types/domain'

import { SettingsSection } from './settings-section'

/**
 * Global Scripts section. Lists every non-utility script with a Switch that
 * toggles its `kind` between `global` and `normal` via `set_script_kind`.
 * Utility scripts are excluded — they are phase-less snippets, never global
 * execution entries.
 */
export function GlobalScriptsSection(): React.JSX.Element {
  const scriptsQuery = useScriptsQuery()
  const setKindMutation = useSetScriptKindMutation()

  const toggleable = (scriptsQuery.data ?? []).filter((script) => script.kind !== 'utility')

  async function handleToggle(script: Script, makeGlobal: boolean): Promise<void> {
    try {
      await setKindMutation.mutateAsync({
        id: script.id,
        kind: makeGlobal ? 'global' : 'normal',
      })
    } catch (err) {
      const details = err instanceof Error ? err.message : String(err)
      toastError('Could not update global flag', {
        description: script.name,
        category: 'settings.globalScripts',
        details,
      })
    }
  }

  return (
    <SettingsSection
      icon="bolt"
      title="Global Scripts"
      description="Scripts that run for every game, without per-game assignment."
    >
      {toggleable.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-10 text-center"
          data-testid="global-scripts-placeholder"
        >
          <Icon name="code_off" className="text-[32px] text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Global script toggles appear here once you create scripts.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border" data-testid="global-scripts-list">
          {toggleable.map((script) => {
            const isGlobal = script.kind === 'global'
            return (
              <li key={script.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{script.name}</p>
                  {script.description ? (
                    <p className="truncate text-xs text-muted-foreground">{script.description}</p>
                  ) : null}
                </div>
                <Switch
                  checked={isGlobal}
                  disabled={setKindMutation.isPending}
                  aria-label={`Run ${script.name} globally`}
                  onCheckedChange={(checked) => void handleToggle(script, checked)}
                />
              </li>
            )
          })}
        </ul>
      )}
    </SettingsSection>
  )
}
