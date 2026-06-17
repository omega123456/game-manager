import { ThemeControl } from '@/components/theme/theme-control'

/**
 * Top bar: holds the theme control. Library search lives in the library toolbar.
 */
export function TopBar(): React.JSX.Element {
  return (
    <header
      data-testid="top-bar"
      className="flex h-16 items-center gap-4 border-b border-border bg-surface px-6"
    >
      <div className="ml-auto flex items-center gap-3">
        <ThemeControl />
      </div>
    </header>
  )
}
