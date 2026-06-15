import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '@/lib/utils'

export function TooltipProvider(
  props: React.ComponentProps<typeof TooltipPrimitive.Provider>
): React.JSX.Element {
  return <TooltipPrimitive.Provider {...props} />
}

export function Tooltip(
  props: React.ComponentProps<typeof TooltipPrimitive.Root>
): React.JSX.Element {
  return <TooltipPrimitive.Root {...props} />
}

export function TooltipTrigger(
  props: React.ComponentProps<typeof TooltipPrimitive.Trigger>
): React.JSX.Element {
  return <TooltipPrimitive.Trigger {...props} />
}

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 overflow-hidden rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95',
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName
