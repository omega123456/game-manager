import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import type { Group } from '@/types/domain'

const MAX_CHIPS = 2

export interface GroupListProps {
  groups: Group[]
  selectedId: number | null
  gameCountByGroupId: Map<number, number>
  scriptCountByGroupId: Map<number, number>
  scriptNamesByGroupId: Map<number, string[]>
  onSelect: (groupId: number) => void
  onNew: () => void
}

export function GroupList({
  groups,
  selectedId,
  gameCountByGroupId,
  scriptCountByGroupId,
  scriptNamesByGroupId,
  onSelect,
  onNew,
}: GroupListProps): React.JSX.Element {
  return (
    <div className="flex h-full flex-col border-r border-border bg-surface-low">
      <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
        <h2 className="font-heading text-xl font-bold text-foreground">Groups</h2>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="New"
          onClick={onNew}
          className="h-8 w-8 rounded-full bg-surface-high text-foreground hover:bg-primary hover:text-primary-foreground"
        >
          <Icon name="add" className="text-[20px]" />
        </Button>
      </header>

      <ul className="flex-1 space-y-2 overflow-y-auto p-3" aria-label="Groups">
        {groups.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">
            No groups yet. Create one to organize shared scripts.
          </li>
        ) : (
          groups.map((group) => {
            const active = group.id === selectedId
            const gameCount = gameCountByGroupId.get(group.id) ?? group.gameIds.length
            const scriptCount = scriptCountByGroupId.get(group.id) ?? group.scriptIds.length
            const chips = scriptNamesByGroupId.get(group.id) ?? []
            return (
              <li key={group.id}>
                <button
                  type="button"
                  onClick={() => onSelect(group.id)}
                  aria-label={`Edit ${group.name}`}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full cursor-pointer flex-col rounded-xl border-2 p-4 text-left transition-colors',
                    active
                      ? 'border-primary bg-surface-container'
                      : 'border-transparent bg-surface hover:bg-surface-container'
                  )}
                >
                  <span
                    className={cn(
                      'truncate font-heading text-base font-bold',
                      active ? 'text-primary' : 'text-foreground'
                    )}
                  >
                    {group.name}
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {gameCount} {gameCount === 1 ? 'Title' : 'Titles'} • {scriptCount}{' '}
                    {scriptCount === 1 ? 'Active Script' : 'Active Scripts'}
                  </p>
                  {chips.length > 0 ? (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {chips.slice(0, MAX_CHIPS).map((name) => (
                        <span
                          key={name}
                          className="max-w-[10rem] truncate rounded-full bg-surface-high px-2.5 py-0.5 text-xs text-foreground"
                        >
                          {name}
                        </span>
                      ))}
                      {chips.length > MAX_CHIPS ? (
                        <span className="shrink-0 rounded px-1 py-0.5 text-xs text-muted-foreground">
                          {chips.length - MAX_CHIPS} more
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
