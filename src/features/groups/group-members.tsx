import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Icon } from '@/components/ui/icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Game } from '@/types/domain'

export interface GroupMembersProps {
  games: Game[]
  memberGameIds: number[]
  disabled?: boolean
  onAssign: (gameId: number) => void
  onRemove: (gameId: number) => void
}

export function GroupMembers({
  games,
  memberGameIds,
  disabled = false,
  onAssign,
  onRemove,
}: GroupMembersProps): React.JSX.Element {
  const [open, setOpen] = useState(false)

  const selectableGames = useMemo(
    () => [...games].sort((a, b) => a.name.localeCompare(b.name)),
    [games]
  )

  const memberGames = useMemo(
    () =>
      memberGameIds
        .map((id) => selectableGames.find((game) => game.id === id))
        .filter((game): game is Game => game !== undefined),
    [memberGameIds, selectableGames]
  )

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface-low p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-heading text-base font-semibold text-foreground">Member games</h3>
          <p className="text-sm text-muted-foreground">
            Games in this group inherit its assigned scripts.
          </p>
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="group-member-picker-trigger"
            >
              <Icon name="add" className="text-[18px]" />
              Add game
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <Command>
              <CommandInput placeholder="Search games…" />
              <CommandList>
                <CommandEmpty>No games found.</CommandEmpty>
                <CommandGroup>
                  {selectableGames.map((game) => {
                    const assigned = memberGameIds.includes(game.id)
                    return (
                      <CommandItem
                        key={game.id}
                        value={game.name}
                        disabled={assigned || disabled}
                        onSelect={() => {
                          if (assigned || disabled) {
                            return
                          }
                          onAssign(game.id)
                          setOpen(false)
                        }}
                      >
                        <Icon name="sports_esports" className="text-[16px]" />
                        <span className="flex-1">{game.name}</span>
                        {assigned ? (
                          <Icon name="check" className="text-[16px] text-primary" />
                        ) : null}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {memberGames.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground"
          data-testid="group-members-empty"
        >
          No games belong to this group yet.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="group-members-list">
          {memberGames.map((game) => (
            <li
              key={game.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-background/60 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{game.name}</p>
                <p className="truncate text-xs text-muted-foreground">{game.launchTarget}</p>
              </div>
              <Badge variant="muted" className="gap-1.5 pr-1">
                <Icon name="sports_esports" className="text-[14px]" />
                <span>Member</span>
                <button
                  type="button"
                  aria-label={`Remove ${game.name}`}
                  disabled={disabled}
                  onClick={() => onRemove(game.id)}
                  className="cursor-pointer rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-surface-highest hover:text-foreground disabled:cursor-not-allowed"
                >
                  <Icon name="close" className="text-[14px]" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
