/**
 * Draft-counting helpers — single source of truth for "how many drafts
 * has this org generated since X?".
 *
 * The billing event is `NOTE_GENERATION_COMPLETED`. resourceId IS the
 * noteId. We count distinct resourceIds so a regenerate-section pass
 * doesn't double-bill (one draft per encounter, regardless of how
 * many regenerations happen against it).
 *
 * Used by:
 *   - /account/usage page (customer view)
 *   - /home cockpit pill (live counter)
 *   - /owner/pricing-insights (cross-org rollup)
 *   - scripts/billing-usage-report.ts (Stripe metered reporting)
 *
 * PHI fence: reads only `resourceId` from AuditLog, never note bodies.
 */

import { prisma } from '@/lib/prisma';

const MS_PER_DAY = 86_400_000;

/**
 * Distinct draft count for an org since `since`. Pure DB query — no
 * caching at this layer because the home cockpit needs a fresh count
 * on every render (the clinician just finished a note).
 */
export async function countOrgDraftsSince(
  orgId: string,
  since: Date,
): Promise<number> {
  const rows = await prisma.auditLog.findMany({
    where: {
      orgId,
      action: 'NOTE_GENERATION_COMPLETED',
      createdAt: { gte: since },
      resourceId: { not: null },
    },
    select: { resourceId: true },
    distinct: ['resourceId'],
  });
  return rows.length;
}

/**
 * Distinct draft count for the trailing 30 days — what the customer-
 * facing pill + the /account/usage page show.
 *
 * NOTE: this is a CALENDAR-WINDOW approximation, not the Stripe billing
 * period. The actual billed overage uses `Subscription.current_period_
 * start` (see `usage-reporter.ts`). Showing the calendar 30-day window
 * to the customer is a deliberate UX choice — they think in months,
 * not subscription anniversaries.
 */
export async function countOrgDraftsLast30Days(
  orgId: string,
  now: Date = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - 30 * MS_PER_DAY);
  return countOrgDraftsSince(orgId, since);
}
