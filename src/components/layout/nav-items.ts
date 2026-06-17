/** Canonical sidebar navigation (Game Library, Script Manager, Group Manager, Settings, Logs). */
export interface NavItem {
  to: string
  label: string
  icon: string
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/library', label: 'Game Library', icon: 'sports_esports' },
  { to: '/scripts', label: 'Script Manager', icon: 'terminal' },
  { to: '/groups', label: 'Group Manager', icon: 'groups' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
  { to: '/logs', label: 'Logs', icon: 'receipt_long' },
]
