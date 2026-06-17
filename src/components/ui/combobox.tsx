import * as React from 'react'

import { cn } from '@/lib/utils'
import { Icon } from '@/components/ui/icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

/** A single selectable combobox option. */
export interface ComboboxOption {
  /** Stable value passed to `onChange` when selected. */
  value: string
  /** Plain text used for type-ahead filtering and as the default trigger label. */
  label: string
  /** Optional group heading this option belongs to. */
  group?: string
  /** Optional disabled flag. */
  disabled?: boolean
  /** Custom right-aligned trailing content for the option row (e.g. size + icon). */
  trailing?: React.ReactNode
}

export interface ComboboxProps {
  /** Available options (may carry `group` for grouped rendering). */
  options: ComboboxOption[]
  /** Currently selected value, or `null` when nothing is selected. */
  value: string | null
  /** Called with the selected option value. */
  onChange: (value: string) => void
  /** Accessible label, associated with the trigger via `aria-label`. */
  label: string
  /** Placeholder shown when no value is selected. */
  placeholder?: string
  /** Placeholder for the search input. */
  searchPlaceholder?: string
  /** Text shown when no option matches the search. */
  emptyText?: string
  /** Disable the whole control. */
  disabled?: boolean
  /**
   * Controlled "progress" state. When set, the trigger renders this content
   * (e.g. an inline download progress label), is disabled, and the popover is
   * suppressed. The content is announced via an `aria-live="polite"` region.
   */
  progress?: React.ReactNode
  /** Optional id for the trigger button (for external label association). */
  id?: string
  /** Extra classes for the trigger. */
  className?: string
}

/**
 * Searchable single-select built on `command` + `popover`. Supports grouped
 * options, per-option trailing content, and a controlled `progress` trigger
 * state used by the DLSS version picker while a download is in flight.
 */
export function Combobox({
  options,
  value,
  onChange,
  label,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No results.',
  disabled = false,
  progress,
  id,
  className,
}: ComboboxProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)

  const selected = value === null ? undefined : options.find((option) => option.value === value)
  const isBusy = progress !== undefined && progress !== null
  const triggerDisabled = disabled || isBusy

  // Build the grouped structure preserving option order. Options without a
  // `group` fall under an unnamed leading group.
  const groups: { name: string | undefined; items: ComboboxOption[] }[] = []
  for (const option of options) {
    const last = groups[groups.length - 1]
    if (last && last.name === option.group) {
      last.items.push(option)
    } else {
      groups.push({ name: option.group, items: [option] })
    }
  }

  const trigger = (
    <button
      id={id}
      type="button"
      role="combobox"
      aria-expanded={open}
      aria-label={label}
      disabled={triggerDisabled}
      className={cn(
        'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer',
        className
      )}
    >
      {isBusy ? (
        <span
          className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground"
          aria-live="polite"
        >
          <Icon name="downloading" className="animate-spin text-[18px]" />
          <span className="truncate">{progress}</span>
        </span>
      ) : (
        <span className={cn('truncate', !selected && 'text-muted-foreground')}>
          {selected ? selected.label : placeholder}
        </span>
      )}
      <Icon name="expand_more" className="shrink-0 text-[18px] opacity-60" />
    </button>
  )

  if (isBusy) {
    return trigger
  }

  // `modal` is required when this combobox is rendered inside a Radix Dialog:
  // without it, the dialog's body scroll lock prevents wheel scrolling in the
  // portaled popover list (see radix-ui/primitives#1159).
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groups.map((groupEntry, index) => (
              <CommandGroup key={groupEntry.name ?? `__group-${index}`} heading={groupEntry.name}>
                {groupEntry.items.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.value}`}
                    disabled={option.disabled}
                    onSelect={() => {
                      onChange(option.value)
                      setOpen(false)
                    }}
                    className="justify-between"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon
                        name="check_circle"
                        filled
                        className={cn(
                          'text-[16px] text-primary',
                          option.value === value ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <span className="truncate">{option.label}</span>
                    </span>
                    {option.trailing ? (
                      <span className="ml-2 flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        {option.trailing}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
