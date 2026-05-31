import * as React from 'react';

import { cn } from '@/lib/cn';

type MeterVariant = 'primary' | 'success' | 'warning' | 'danger';

/** Fill color per variant — token-only. Pair with a <StatusBadge> text label. */
const FILL: Record<MeterVariant, string> = {
  primary: 'bg-primary',
  success: 'bg-[var(--status-success-fg)]',
  warning: 'bg-[var(--status-warning-fg)]',
  danger: 'bg-[var(--status-danger-fg)]',
};

/**
 * MeterBar — a token-filled progress bar for recert windows / visit-cap
 * usage. Color is never the only signal: callers always pair it with a
 * <StatusBadge> text label. Exposes ARIA progressbar semantics.
 */
export function MeterBar({
  value,
  max,
  variant = 'primary',
  className,
  'aria-label': ariaLabel,
}: {
  value: number;
  max: number;
  variant?: MeterVariant;
  className?: string;
  'aria-label'?: string;
}) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={Math.round(safeMax)}
      aria-label={ariaLabel}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width]', FILL[variant])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
