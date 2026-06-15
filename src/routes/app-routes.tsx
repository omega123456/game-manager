import { Navigate, Route, Routes } from 'react-router-dom'

import { AppLayout } from '@/components/layout/app-layout'
import { LibraryRoute } from '@/routes/library-route'
import { ScriptsRoute } from '@/routes/scripts-route'
import { GroupsRoute } from '@/routes/groups-route'
import { SettingsRoute } from '@/routes/settings-route'

/**
 * Route table. `/library` is home; unknown paths redirect to it. Overlays
 * (modals, wizard, dialogs) are Zustand state, never routes.
 */
export function AppRoutes(): React.JSX.Element {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/library" replace />} />
        <Route path="/library" element={<LibraryRoute />} />
        <Route path="/scripts" element={<ScriptsRoute />} />
        <Route path="/groups" element={<GroupsRoute />} />
        <Route path="/settings" element={<SettingsRoute />} />
        <Route path="*" element={<Navigate to="/library" replace />} />
      </Route>
    </Routes>
  )
}
