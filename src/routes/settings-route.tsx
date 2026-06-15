import { ApiKeysSection } from '@/features/settings/api-keys-section'
import { AppearanceSection } from '@/features/settings/appearance-section'
import { GlobalScriptsSection } from '@/features/settings/global-scripts-section'

/**
 * Settings page. Sectioned layout: Global Scripts (placeholder until C2), API
 * Integrations, and Appearance. All sections persist through the backend
 * `settings` table; Appearance binds to the shared ThemeProvider.
 */
export function SettingsRoute(): React.JSX.Element {
  return (
    <div className="mx-auto h-full w-full max-w-3xl overflow-y-auto p-8">
      <header className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure integrations and the look of the app.
        </p>
      </header>
      <div className="space-y-6">
        <GlobalScriptsSection />
        <ApiKeysSection />
        <AppearanceSection />
      </div>
    </div>
  )
}

export default SettingsRoute
