import { useRef } from 'react'

import { cn } from '@/lib/utils'

export interface SegmentedControlOption<T extends string> {
  value: T
  label: string
  /** Optional count shown in a pill after the label. */
  count?: number
}

export interface SegmentedControlProps<T extends string> {
  value: T
  options: readonly SegmentedControlOption<T>[]
  onValueChange: (value: T) => void
  'aria-label': string
  className?: string
}

/**
 * A single-choice segmented switch (`radiogroup`). Arrow keys, Home and End move
 * the selection; only the selected segment is in the tab order.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onValueChange,
  'aria-label': ariaLabel,
  className,
}: SegmentedControlProps<T>): React.JSX.Element {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  function select(index: number): void {
    const option = options[index]
    onValueChange(option.value)
    buttonRefs.current[index]?.focus()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = options.length - 1
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = index === last ? 0 : index + 1
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = index === 0 ? last : index - 1
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = last
    }
    if (next !== null) {
      event.preventDefault()
      select(next)
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center rounded-lg border border-border bg-surface-low p-0.5',
        className
      )}
    >
      {options.map((option, index) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttonRefs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={
              option.count === undefined ? option.label : `${option.label}, ${option.count}`
            }
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'flex h-8 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors',
              active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.label}
            {option.count === undefined ? null : (
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs tabular-nums',
                  active ? 'bg-primary/15' : 'bg-surface-high'
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
