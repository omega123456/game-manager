import { Icon } from '@/components/ui/icon'
import { Switch } from '@/components/ui/switch'
import { toastError } from '@/lib/app-log-commands'
import { useScriptsQuery, useSetScriptEnabledMutation } from '@/lib/queries/use-scripts'
import type { Script } from '@/types/domain'

import { SettingsSection } from './settings-section'

/**
 * Global Scripts section. Lists only scripts whose persisted `kind` is
 * `global`, with a Switch that enables/disables each one via
 * `set_script_enabled`. Disabled scripts stay global but are skipped at launch.
 */
export function GlobalScriptsSection(): React.JSX.Element {
  const scriptsQuery = useScriptsQuery()
  const setEnabledMutation = useSetScriptEnabledMutation()

  const globalScripts = (scriptsQuery.data ?? []).filter((script) => script.kind === 'global')

  async function handleToggle(script: Script, enabled: boolean): Promise<void> {
    try {
      await setEnabledMutation.mutateAsync({ id: script.id, enabled })
    } catch (err) {
      const details = err instanceof Error ? err.message : String(err)
      toastError('Could not update global script', {
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
      {globalScripts.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-10 text-center"
          data-testid="global-scripts-placeholder"
        >
          <Icon name="code_off" className="text-[32px] text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Scripts marked global will appear here.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border" data-testid="global-scripts-list">
          {globalScripts.map((script) => (
            <li key={script.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{script.name}</p>
                {script.description ? (
                  <p className="truncate text-xs text-muted-foreground">{script.description}</p>
                ) : null}
              </div>
              <Switch
                checked={script.enabled}
                disabled={setEnabledMutation.isPending}
                aria-label={`Run ${script.name} globally`}
                onCheckedChange={(checked) => void handleToggle(script, checked)}
              />
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  )
}
