import { Icon } from '@/components/ui/icon'

import { SettingsSection } from './settings-section'

/**
 * Global Scripts section — placeholder until the Scripts domain exists.
 *
 * Phase C2 replaces this body with per-script `Switch` toggles that flip a
 * script's `kind` to `global`. Until any scripts are created there is nothing to
 * toggle, so we render an empty-state hint.
 */
export function GlobalScriptsSection(): React.JSX.Element {
  return (
    <SettingsSection
      icon="bolt"
      title="Global Scripts"
      description="Scripts that run for every game, without per-game assignment."
    >
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-10 text-center"
        data-testid="global-scripts-placeholder"
      >
        <Icon name="code_off" className="text-[32px] text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Global script toggles appear here once you create scripts.
        </p>
      </div>
    </SettingsSection>
  )
}
