import { Badge } from '@/components/ui/badge'
import { Icon } from '@/components/ui/icon'
import { resolveGameCardGroups } from '@/features/games/game-card-group-display'
import { cn } from '@/lib/utils'
import type { Group } from '@/types/domain'

export interface GameCardGroupsProps {
  groupIds: number[]
  groups: Group[]
}

export function GameCardGroups({ groupIds, groups }: GameCardGroupsProps): React.JSX.Element {
  const { visibleGroups, overflowCount } = resolveGameCardGroups(groupIds, groups)
  const pillCount = visibleGroups.length + (overflowCount > 0 ? 1 : 0)
  const useSingleColumn = pillCount <= 1

  const pills = [
    ...visibleGroups.map((group) => ({ key: `group-${group.id}`, label: group.name, group })),
    ...(overflowCount > 0
      ? [{ key: 'overflow', label: `${overflowCount} more…`, overflowCount }]
      : []),
  ]

  return (
    <div
      className={cn(
        'grid h-[4.5rem] content-start gap-x-2 gap-y-2',
        useSingleColumn ? 'grid-cols-1' : 'grid-cols-2'
      )}
      aria-label="Groups"
      data-testid="game-card-groups"
    >
      {pills.map((pill, index) => {
        const spansFullRow = !useSingleColumn && pillCount % 2 === 1 && index === pillCount - 1

        if ('group' in pill) {
          return (
            <Badge
              key={pill.key}
              variant="muted"
              className={cn(
                'flex w-full min-w-0 gap-1.5 overflow-hidden',
                spansFullRow && 'col-span-2'
              )}
              title={pill.group.name}
            >
              <Icon name="groups" className="shrink-0 text-[14px]" />
              <span className="min-w-0 flex-1 truncate">{pill.group.name}</span>
            </Badge>
          )
        }

        return (
          <Badge
            key={pill.key}
            variant="outline"
            className={cn(
              'flex w-full min-w-0 justify-center overflow-hidden',
              spansFullRow && 'col-span-2'
            )}
          >
            {pill.label}
          </Badge>
        )
      })}
    </div>
  )
}
