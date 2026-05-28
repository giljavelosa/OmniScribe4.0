import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Props = {
  children: ReactNode;
  className?: string;
};

/**
 * Scroll container for dense admin/owner tables. Pair with a sticky `<thead>`
 * row (`sticky top-0 z-10 bg-muted/30 backdrop-blur-sm`) so column headers
 * stay visible while rows scroll.
 */
export function ScrollableTablePanel({ children, className }: Props) {
  return (
    <div
      className={cn(
        'min-h-0 overflow-auto rounded-md border border-border',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Shared sticky header styling for tables inside ScrollableTablePanel. */
export const SCROLLABLE_TABLE_HEAD_ROW =
  'border-b border-border bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground sticky top-0 z-10 backdrop-blur-sm';
