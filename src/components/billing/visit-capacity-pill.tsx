import Link from 'next/link';
import { Coins } from 'lucide-react';

import { cn } from '@/lib/cn';

type Props = {
  availableVisits: number;
  compact?: boolean;
  className?: string;
};

/**
 * VisitCapacityPill — home cockpit counter for visit-bank orgs.
 * Replaces DraftUsagePill when OrganizationCommercialContract enforcement
 * is active. Click → /account/usage.
 */
export function VisitCapacityPill({ availableVisits, compact = false, className }: Props) {
  const tone =
    availableVisits <= 0 ? 'danger' : availableVisits <= 10 ? 'warning' : 'muted';

  const toneClasses = {
    muted: 'text-muted-foreground hover:text-foreground border-border',
    warning:
      'text-[var(--status-warning-fg)] hover:text-[var(--status-warning-fg)] border-[var(--status-warning-border)] bg-[color-mix(in_oklab,var(--status-warning-bg)_25%,transparent)]',
    danger:
      'text-[var(--status-danger-fg)] hover:text-[var(--status-danger-fg)] border-[var(--status-danger-border)] bg-[color-mix(in_oklab,var(--status-danger-bg)_25%,transparent)]',
  }[tone];

  return (
    <Link
      href="/account/usage"
      className={cn(
        'inline-flex items-center gap-2 rounded-md border px-2.5 py-1 transition-colors min-h-[var(--touch-min)] text-xs',
        toneClasses,
        className,
      )}
      aria-label={`${availableVisits.toLocaleString()} visits available — view usage`}
    >
      <Coins className="h-3 w-3 shrink-0" aria-hidden />
      {!compact && (
        <span className="text-muted-foreground/80 hidden sm:inline">Visits:</span>
      )}
      <span className="font-mono tabular-nums font-medium">
        {availableVisits.toLocaleString()}
      </span>
      {!compact && <span className="text-muted-foreground/80 hidden sm:inline">available</span>}
    </Link>
  );
}
