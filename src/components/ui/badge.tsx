import * as React from 'react'

import { cn } from '@/lib/utils'
import { badgeVariants, type BadgeVariantProps } from '@/components/ui/badge-variants'

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, BadgeVariantProps {}

export function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
