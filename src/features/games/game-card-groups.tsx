import { Badge } from '@/components/ui/badge'
import { Icon } from '@/components/ui/icon'
import { resolveGameCardGroups } from '@/features/games/game-card-group-display'
import type { Group } from '@/types/domain'

export interface GameCardGroupsProps {
  groupIds: number[]
  groups: Group[]
}

export function GameCardGroups({ groupIds, groups }: GameCardGroupsProps): React.JSX.Element {
  const { visibleGroups, overflowCount } = resolveGameCardGroups(groupIds, groups)

  return (
    <div
      className="grid h-[4.5rem] grid-cols-2 gap-x-2 gap-y-2 content-start"
      aria-label="Groups"
      data-testid="game-card-groups"
    >
      {visibleGroups.map((group) => (
        <Badge
          key={group.id}
          variant="muted"
          className="flex w-full min-w-0 gap-1.5 overflow-hidden"
          title={group.name}
        >
          <Icon name="groups" className="shrink-0 text-[14px]" />
          <span className="min-w-0 flex-1 truncate">{group.name}</span>
        </Badge>
      ))}
      {overflowCount > 0 ? (
        <Badge variant="outline" className="w-fit max-w-full shrink-0 justify-self-start">
          {overflowCount} more…
        </Badge>
      ) : null}
    </div>
  )
}
