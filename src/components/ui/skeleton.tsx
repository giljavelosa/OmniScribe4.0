import * as React from 'react';

import { cn } from '@/lib/cn';

/**
 * Skeleton — server-safe loading placeholder. Codifies the
 * `animate-pulse rounded bg-muted` idiom used ad-hoc across the app
 * (e.g. brief/empty-brief.tsx). No hooks so route-level `loading.tsx`
 * can render it. Reduced-motion is honored globally in globals.css.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

/** N stacked text-line bars; the last line is shortened. */
function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-1/2' : 'w-full')} />
      ))}
    </div>
  );
}

/** Card-shaped skeleton: small label bar + value bar + line. */
function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn('space-y-3 rounded-xl border bg-card p-4 shadow-sm', className)}
      aria-hidden
    >
      <Skeleton className="h-2.5 w-1/3" />
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-3 w-full" />
    </div>
  );
}

export { Skeleton, SkeletonText, SkeletonCard };
