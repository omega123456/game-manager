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

export interface GameScriptAssignmentProps {
  scripts: Script[]
  assignedScriptIds: number[]
  title: string
  description: string
  emptyLabel: string
  triggerLabel: string
  disabled?: boolean
  onAssign: (scriptId: number) => void
  onRemove?: (scriptId: number) => void
}

export function GameScriptAssignment({
  scripts,
  assignedScriptIds,
  title,
  description,
  emptyLabel,
  triggerLabel,
  disabled = false,
  onAssign,
  onRemove,
}: GameScriptAssignmentProps): React.JSX.Element {
  const [open, setOpen] = useState(false)

  const selectableScripts = useMemo(
    () => scripts.filter((script) => script.kind === 'normal').sort((a, b) => a.name.localeCompare(b.name)),
    [scripts]
  )

  const assignedScripts = assignedScriptIds
    .map((id) => selectableScripts.find((script) => script.id === id))
    .filter((script): script is Script => script !== undefined)

  return (
    <section className="space-y-3 rounded-[1.5rem] border border-border bg-surface-low p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-heading text-base font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {onRemove ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <Icon name="playlist_add" className="text-[18px]" />
                {triggerLabel}
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
                          {assigned ? <Icon name="check" className="text-[16px] text-primary" /> : null}
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>

      {assignedScripts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {assignedScripts.map((script) => (
            <Badge key={script.id} variant="muted" className="gap-1.5 pr-1">
              <Icon name="code" className="text-[14px]" />
              <span>{script.name}</span>
              {onRemove ? (
                <button
                  type="button"
                  aria-label={`Remove ${script.name}`}
                  disabled={disabled}
                  onClick={() => onRemove(script.id)}
                  className="cursor-pointer rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-surface-highest hover:text-foreground disabled:cursor-not-allowed"
                >
                  <Icon name="close" className="text-[14px]" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      )}
    </section>
  )
}
