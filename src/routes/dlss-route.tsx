import { DlssManagementPage } from '@/features/dlss/dlss-management-page'

/**
 * DLSS Management route. Thin shell around the page content (overlays remain
 * Zustand state, not routes).
 */
export function DlssRoute(): React.JSX.Element {
  return <DlssManagementPage />
}

export default DlssRoute
