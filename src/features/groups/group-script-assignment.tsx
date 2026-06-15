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
import type { Script } from '@/types/domain'

export interface GroupScriptAssignmentProps {
  scripts: Script[]
  assignedScriptIds: number[]
  disabled?: boolean
  onAssign: (scriptId: number) => void
  onRemove: (scriptId: number) => void
}

export function GroupScriptAssignment({
  scripts,
  assignedScriptIds,
  disabled = false,
  onAssign,
  onRemove,
}: GroupScriptAssignmentProps): React.JSX.Element {
  const [open, setOpen] = useState(false)

  const selectableScripts = useMemo(
    () =>
      scripts
        .filter((script) => script.kind === 'normal')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [scripts]
  )

  const assignedScripts = assignedScriptIds
    .map((id) => selectableScripts.find((script) => script.id === id))
    .filter((script): script is Script => script !== undefined)

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface-low p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-heading text-base font-semibold text-foreground">Assigned scripts</h3>
          <p className="text-sm text-muted-foreground">
            Normal scripts only. Global and utility scripts are excluded.
          </p>
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" data-testid="group-script-picker-trigger">
              <Icon name="playlist_add" className="text-[18px]" />
              Add script
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <Command>
              <CommandInput placeholder="Search normal scripts…" />
              <CommandList>
                <CommandEmpty>No assignable scripts found.</CommandEmpty>
                <CommandGroup>
                  {selectableScripts.map((script) => {
                    const assigned = assignedScriptIds.includes(script.id)
                    return (
                      <CommandItem
                        key={script.id}
                        value={script.name}
                        disabled={assigned || disabled}
                        onSelect={() => {
                          if (assigned || disabled) {
                            return
                          }
                          onAssign(script.id)
                          setOpen(false)
                        }}
                      >
                        <Icon name="code" className="text-[16px]" />
                        <span className="flex-1">{script.name}</span>
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

      {assignedScripts.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground"
          data-testid="group-script-empty"
        >
          No scripts assigned yet.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2" data-testid="group-script-chips">
          {assignedScripts.map((script) => (
            <Badge key={script.id} variant="muted" className="gap-1.5 pr-1">
              <Icon name="code" className="text-[14px]" />
              <span>{script.name}</span>
              <button
                type="button"
                aria-label={`Remove ${script.name}`}
                disabled={disabled}
                onClick={() => onRemove(script.id)}
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
