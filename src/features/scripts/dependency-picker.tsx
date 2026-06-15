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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Script } from '@/types/domain'

import { wouldCreateCycle } from './script-form-types'

export interface DependencyPickerProps {
  /** Id of the script being edited (excluded from the candidate list). */
  scriptId: number
  /** All scripts (used to find utilities + preview cycles). */
  allScripts: Script[]
  /** Currently-required utility ids. */
  requires: number[]
  /** Add a require edge. */
  onAdd: (utilityId: number) => void
  /** Remove a require edge. */
  onRemove: (utilityId: number) => void
}

/**
 * The "Requires" picker — manages a script's require/include edges. Selected
 * utilities show as removable chips. The Add Requirement popover lists utility
 * scripts only (self excluded). Already-required and cycle-creating options are
 * disabled with a loop icon + tooltip; the backend stays authoritative.
 */
export function DependencyPicker({
  scriptId,
  allScripts,
  requires,
  onAdd,
  onRemove,
}: DependencyPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)

  const byId = useMemo(() => new Map(allScripts.map((s) => [s.id, s])), [allScripts])

  const utilities = useMemo(
    () => allScripts.filter((s) => s.kind === 'utility' && s.id !== scriptId),
    [allScripts, scriptId]
  )

  const selectedChips = requires
    .map((id) => byId.get(id))
    .filter((s): s is Script => s !== undefined)

  return (
    <div className="space-y-3" data-testid="dependency-picker">
      <div className="flex flex-wrap items-center gap-2">
        {selectedChips.length === 0 ? (
          <p className="text-sm text-muted-foreground">No required utilities.</p>
        ) : (
          selectedChips.map((utility) => (
            <Badge key={utility.id} variant="muted" className="gap-1.5 pr-1">
              <Icon name="extension" className="text-[14px]" />
              <span className="font-mono">{utility.name}</span>
              <button
                type="button"
                aria-label={`Remove ${utility.name}`}
                onClick={() => onRemove(utility.id)}
                className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-surface-highest hover:text-foreground"
              >
                <Icon name="close" className="text-[14px]" />
              </button>
            </Badge>
          ))
        )}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <Icon name="add" className="text-[18px]" />
            Add Requirement
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          <Command>
            <CommandInput placeholder="Search utility scripts…" />
            <CommandList>
              <CommandEmpty>No utility scripts found.</CommandEmpty>
              <CommandGroup>
                {utilities.map((utility) => {
                  const alreadyRequired = requires.includes(utility.id)
                  const cyclic = wouldCreateCycle(scriptId, utility.id, allScripts)
                  const disabled = alreadyRequired || cyclic
                  const reason = alreadyRequired
                    ? 'Already required'
                    : 'would create a circular reference'

                  const item = (
                    <CommandItem
                      key={utility.id}
                      value={utility.name}
                      disabled={disabled}
                      onSelect={() => {
                        if (disabled) {
                          return
                        }
                        onAdd(utility.id)
                        setOpen(false)
                      }}
                      className={cn(disabled && 'opacity-50')}
                      data-disabled-reason={disabled ? reason : undefined}
                    >
                      <Icon name="extension" className="text-[16px]" />
                      <span className="flex-1 font-mono">{utility.name}</span>
                      {alreadyRequired ? (
                        <Icon name="check" className="text-[16px] text-primary" />
                      ) : cyclic ? (
                        <Icon
                          name="sync_problem"
                          className="text-[16px] text-muted-foreground"
                          aria-label={reason}
                        />
                      ) : null}
                    </CommandItem>
                  )

                  if (cyclic && !alreadyRequired) {
                    return (
                      <Tooltip key={utility.id}>
                        <TooltipTrigger asChild>
                          <div>{item}</div>
                        </TooltipTrigger>
                        <TooltipContent>{reason}</TooltipContent>
                      </Tooltip>
                    )
                  }
                  return item
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
