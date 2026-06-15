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
import type { Group } from '@/types/domain'

export interface GameGroupMembershipProps {
  groups: Group[]
  selectedGroupIds: number[]
  disabled?: boolean
  onAssign: (groupId: number) => void
  onRemove: (groupId: number) => void
}

export function GameGroupMembership({
  groups,
  selectedGroupIds,
  disabled = false,
  onAssign,
  onRemove,
}: GameGroupMembershipProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const selectedGroups = useMemo(
    () =>
      selectedGroupIds
        .map((id) => groups.find((group) => group.id === id))
        .filter((group): group is Group => group !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [groups, selectedGroupIds]
  )

  return (
    <section className="space-y-3 rounded-[1.5rem] border border-border bg-surface-low p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-heading text-base font-semibold text-foreground">Groups</h3>
          <p className="text-sm text-muted-foreground">
            Membership controls inherited scripts and the library group filter.
          </p>
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <Icon name="group_add" className="text-[18px]" />
              Add group
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <Command>
              <CommandInput placeholder="Search groups…" />
              <CommandList>
                <CommandEmpty>No groups found.</CommandEmpty>
                <CommandGroup>
                  {groups.map((group) => {
                    const assigned = selectedGroupIds.includes(group.id)
                    return (
                      <CommandItem
                        key={group.id}
                        value={group.name}
                        disabled={assigned || disabled}
                        onSelect={() => {
                          if (assigned || disabled) {
                            return
                          }
                          onAssign(group.id)
                          setOpen(false)
                        }}
                      >
                        <Icon name="groups" className="text-[16px]" />
                        <span className="flex-1">{group.name}</span>
                        {assigned ? <Icon name="check" className="text-[16px] text-primary" /> : null}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {selectedGroups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          This game does not belong to any groups yet.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {selectedGroups.map((group) => (
            <Badge key={group.id} variant="muted" className="gap-1.5 pr-1">
              <Icon name="groups" className="text-[14px]" />
              <span>{group.name}</span>
              <button
                type="button"
                aria-label={`Remove ${group.name}`}
                disabled={disabled}
                onClick={() => onRemove(group.id)}
                className="cursor-pointer rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-surface-highest hover:text-foreground disabled:cursor-not-allowed"
              >
                <Icon name="close" className="text-[14px]" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </section>
  )
}
