import { Icon } from '@/components/ui/icon'
import type { Game } from '@/types/domain'

export interface GroupMembersProps {
  games: Game[]
}

export function GroupMembers({ games }: GroupMembersProps): React.JSX.Element {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface-low p-5">
      <div>
        <h3 className="font-heading text-base font-semibold text-foreground">Member games</h3>
        <p className="text-sm text-muted-foreground">
          Read-only here. Group membership editing lands in the game detail flow.
        </p>
      </div>

      {games.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground"
          data-testid="group-members-empty"
        >
          No games belong to this group yet.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="group-members-list">
          {games.map((game) => (
            <li
              key={game.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-background/60 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{game.name}</p>
                <p className="truncate text-xs text-muted-foreground">{game.launchTarget}</p>
              </div>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Icon name="sports_esports" className="text-[15px]" />
                Read only
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
