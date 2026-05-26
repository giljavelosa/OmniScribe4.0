import Link from 'next/link';
import { Gauge } from 'lucide-react';
import type { BillingPlan } from '@prisma/client';

import { cn } from '@/lib/cn';
import { computeIncludedDrafts, UNLIMITED } from '@/lib/billing/plan-policy';

/**
 * DraftUsagePill — the live "X of Y drafts this month" counter shown on
 * the home cockpit. Click → /account/usage for the full breakdown.
 *
 * This is the discoverability surface for usage. A clinician hitting
 * /home every day sees their consumption like a battery icon — no
 * surprise bills, and the upgrade decision becomes natural ("I'm
 * always near 160; time for Pro").
 *
 * Variants
 * --------
 *  - SOLO/Practice/Duo with bundle: shows X / Y + a progress bar.
 *  - TRIAL: same shape (TRIAL has a 50-draft soft cap).
 *  - SOLO_UNLIMITED / ENTERPRISE: shows just X (no denominator).
 *
 * Color logic (PHI-free; same thresholds as recording-limits warnings):
 *  - 0-79% of bundle  → muted (default)
 *  - 80-99%           → warning (yellow)
 *  - 100%+            → danger (red)
 *
 * Server component — counts come from the page that renders it (the
 * pill itself doesn't query Prisma, so it's reusable on any surface
 * that has the count handy: home cockpit, sidebar, mobile menu).
 */

type Props = {
  /** Drafts the org has used in the current period (last 30 days). */
  draftsUsed: number;
  /** The org's BillingPlan — drives bundle math + label. */
  billingPlan: BillingPlan;
  /** Active OrgUser count — needed for per-seat plans (Duo, Practice). */
  seatCount: number;
  /** Compact mode = no label, just the numbers. Used in the mobile
   *  cockpit where space is tight. */
  compact?: boolean;
  /** Optional extra class — caller can extend the layout. */
  className?: string;
};

export function DraftUsagePill({
  draftsUsed,
  billingPlan,
  seatCount,
  compact = false,
  className,
}: Props) {
  const draftsIncluded = computeIncludedDrafts(billingPlan, seatCount);
  const isUnlimited = draftsIncluded === UNLIMITED;
  const pct = isUnlimited ? 0 : Math.min(100, (draftsUsed / draftsIncluded) * 100);
  const tone = !isUnlimited && pct >= 100
    ? 'danger'
    : !isUnlimited && pct >= 80
      ? 'warning'
      : 'muted';

  const toneClasses = {
    muted: 'text-muted-foreground hover:text-foreground border-border',
    warning:
      'text-[var(--status-warning-fg)] hover:text-[var(--status-warning-fg)] border-[var(--status-warning-border)] bg-[color-mix(in_oklab,var(--status-warning-bg)_25%,transparent)]',
    danger:
      'text-[var(--status-danger-fg)] hover:text-[var(--status-danger-fg)] border-[var(--status-danger-border)] bg-[color-mix(in_oklab,var(--status-danger-bg)_25%,transparent)]',
  }[tone];

  const barTone = {
    muted: 'bg-primary',
    warning: 'bg-[var(--status-warning-fg)]',
    danger: 'bg-[var(--status-danger-fg)]',
  }[tone];

  return (
    <Link
      href="/account/usage"
      className={cn(
        'inline-flex items-center gap-2 rounded-md border px-2.5 py-1 transition-colors min-h-[var(--touch-min)] text-xs',
        toneClasses,
        className,
      )}
      aria-label={
        isUnlimited
          ? `${draftsUsed.toLocaleString()} drafts this month — unlimited plan`
          : `${draftsUsed.toLocaleString()} of ${draftsIncluded.toLocaleString()} drafts used this month — view usage`
      }
    >
      <Gauge className="h-3 w-3 shrink-0" aria-hidden />
      {!compact && (
        <span className="text-muted-foreground/80 hidden sm:inline">Drafts:</span>
      )}
      <span className="font-mono tabular-nums font-medium">
        {draftsUsed.toLocaleString()}
      </span>
      {!isUnlimited && (
        <>
          <span className="text-muted-foreground/60">of</span>
          <span className="font-mono tabular-nums">
            {draftsIncluded.toLocaleString()}
          </span>
          {/* Tiny inline progress bar, hidden on mobile to save space. */}
          <span
            className="hidden md:inline-block ml-1 h-1.5 w-16 bg-muted rounded-full overflow-hidden"
            aria-hidden
          >
            <span
              className={cn('block h-full rounded-full', barTone)}
              style={{ width: `${pct}%` }}
            />
          </span>
        </>
      )}
    </Link>
  );
}
