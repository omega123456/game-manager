import * as React from 'react'

import { cn } from '@/lib/utils'

export interface IconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Material Symbols (Rounded) glyph name, e.g. `sports_esports`. */
  name: string
  /** Render the filled variant of the symbol. */
  filled?: boolean
}

/**
 * Material Symbols (Rounded) icon. Sized via font-size; pass Tailwind text-/h-/w-
 * classes through `className`. Decorative by default (aria-hidden) unless an
 * `aria-label` is provided.
 */
export const Icon = React.forwardRef<HTMLSpanElement, IconProps>(
  ({ name, filled = false, className, style, 'aria-label': ariaLabel, ...props }, ref) => (
    <span
      ref={ref}
      className={cn('material-symbols-rounded select-none', className)}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
      style={filled ? { ...style, fontVariationSettings: "'FILL' 1" } : style}
      {...props}
    >
      {name}
    </span>
  )
)
Icon.displayName = 'Icon'
