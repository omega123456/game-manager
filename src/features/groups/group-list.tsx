import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import type { Group } from '@/types/domain'

export interface GroupListProps {
  groups: Group[]
  selectedId: number | null
  gameCountByGroupId: Map<number, number>
  scriptCountByGroupId: Map<number, number>
  onSelect: (groupId: number) => void
  onNew: () => void
}

export function GroupList({
  groups,
  selectedId,
  gameCountByGroupId,
  scriptCountByGroupId,
  onSelect,
  onNew,
}: GroupListProps): React.JSX.Element {
  return (
    <div className="flex h-full flex-col border-r border-border bg-surface-low">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="font-heading text-sm font-semibold text-foreground">Groups</h2>
        <Button type="button" size="sm" variant="outline" onClick={onNew}>
          <Icon name="add" className="text-[18px]" />
          New
        </Button>
      </header>

      <ul className="flex-1 overflow-y-auto p-2" aria-label="Groups">
        {groups.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">
            No groups yet. Create one to organize shared scripts.
          </li>
        ) : (
          groups.map((group) => {
            const active = group.id === selectedId
            return (
              <li key={group.id}>
                <button
                  type="button"
                  onClick={() => onSelect(group.id)}
                  aria-label={`Edit ${group.name}`}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                    active
                      ? 'border-primary/30 bg-primary/10'
                      : 'border-transparent hover:bg-surface-high'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground">{group.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{scriptCountByGroupId.get(group.id) ?? group.scriptIds.length} scripts</span>
                    <span>{gameCountByGroupId.get(group.id) ?? group.gameIds.length} games</span>
                  </div>
                </button>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
