import { Switch } from '@/components/ui/switch'
import { useSetSettingMutation, useSettingsQuery } from '@/lib/queries/use-settings'

import { SettingsSection } from './settings-section'

const RAISE_PRIORITY_KEY = 'raise_game_priority'

/**
 * Launch settings: toggle that raises the running game's process priority to
 * High (Windows `HIGH_PRIORITY_CLASS`) for smoother scheduling. Default ON — the
 * boost applies unless the stored value is exactly `'false'`.
 */
export function LaunchSection(): React.JSX.Element {
  const { data: settings } = useSettingsQuery()
  const setSetting = useSetSettingMutation()

  const enabled = settings?.[RAISE_PRIORITY_KEY] !== 'false'

  const handleToggle = (next: boolean): void => {
    setSetting.mutate({ key: RAISE_PRIORITY_KEY, value: next ? 'true' : 'false' })
  }

  return (
    <SettingsSection icon="speed" title="Launch" description="How games are run while they play.">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <label htmlFor="raise-game-priority" className="text-sm font-medium text-foreground">
            Raise game priority
          </label>
          <p className="text-sm text-muted-foreground">
            Bump the running game to High priority for smoother performance.
          </p>
        </div>
        <Switch
          id="raise-game-priority"
          aria-label="Raise game priority"
          checked={enabled}
          onCheckedChange={handleToggle}
        />
      </div>
    </SettingsSection>
  )
}
