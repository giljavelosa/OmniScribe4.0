import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * SectionLabel — 12px uppercase tracked label. Used above content blocks
 * across patient detail, admin tables, copilot cards. ui-context.md "type scale".
 */
export function SectionLabel({
  className,
  ...props
}: React.ComponentProps<'p'>) {
  return (
    <p
      className={cn(
        'text-xs uppercase tracking-widest text-muted-foreground font-medium',
        className,
      )}
      {...props}
    />
  );
}
