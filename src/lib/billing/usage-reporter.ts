/**
 * Daily usage reporter — pushes per-org draft counts to Stripe's metered-usage API.
 *
 * Why this exists
 * ---------------
 * Each paid plan's bundle (60 / 160 / 300 drafts) is enforced on the
 * Stripe side as a metered overage Price. Stripe doesn't know how
 * many drafts a clinician produced — it only charges for whatever
 * we report via `subscriptionItems.createUsageRecord`. This module
 * computes the report.
 *
 * What it does
 * ------------
 * 1. For each paid org: count distinct `noteId`s with a
 *    `NOTE_GENERATION_COMPLETED` audit row in the current Stripe
 *    billing period (anchored on `Subscription.current_period_start`).
 * 2. Subtract the org's bundled drafts (`computeIncludedDrafts`) — the
 *    overage equals `max(0, drafts_used - drafts_included)`.
 * 3. Compute the delta vs the last reported overage for this period:
 *    `delta = overage_now - overage_last_reported`. Stripe's metered
 *    API uses INCREMENT actions, so we report the delta, not the
 *    cumulative.
 * 4. Call `stripe.subscriptionItems.createUsageRecord(siId, { quantity:
 *    delta, action: 'increment', timestamp: now })` with an
 *    idempotency key of `${orgId}-${YYYYMMDD}` so a re-run on the
 *    same day is a no-op.
 *
 * What it doesn't do
 * ------------------
 *  - It doesn't read from Stripe to discover the overage subscription
 *    item id; that's looked up by Stripe Price metadata
 *    (`role: 'overage'`) and persisted on `Organization` once at
 *    subscription-create time. The reporter assumes the column is set.
 *  - It doesn't bill TRIAL / SOLO_UNLIMITED / ENTERPRISE orgs
 *    (overageRateCents === 0).
 *  - It doesn't catch retroactive plan changes mid-period — Stripe's
 *    proration handles that on the next invoice; usage-reporting is
 *    purely additive.
 *
 * Idempotency + back-fill
 * -----------------------
 * Two safety properties:
 *   - Same-day re-run = no-op (Stripe dedupes on idempotency_key).
 *   - Missed days reconcile naturally on the next run because we
 *     compute "overage now" from the audit log, not from a stored
 *     cumulative counter. A 24-hour outage just produces a slightly
 *     larger increment on the recovery run.
 */

import { prisma } from '@/lib/prisma';
import { computeIncludedDrafts, getPlanPolicy, UNLIMITED } from './plan-policy';
import type { BillingPlan } from '@prisma/client';

/** Per-org outcome of one reporting run — used by the CLI for log
 *  shipping. PHI-free. */
export type UsageReportRow = {
  orgId: string;
  billingPlan: BillingPlan;
  drafts: number;
  drafts_included: number; // UNLIMITED sentinel preserved
  overage: number; // drafts beyond bundled, never negative
  reported_increment: number; // delta sent to Stripe (zero on idempotent re-run)
  status:
    | 'reported'
    | 'no_change'
    | 'skipped_unbilled' // unlimited / trial / no-stripe-sub
    | 'skipped_unlimited'
    | 'skipped_no_subscription'
    | 'skipped_no_overage_item'
    | 'failed';
  error?: string;
  durationMs: number;
};

export type UsageReporterDeps = {
  /** Injected to keep the reporter testable without a real Stripe call.
   *  Returns true on success. */
  reportToStripe: (args: {
    subscriptionItemId: string;
    quantity: number;
    idempotencyKey: string;
    timestampMs: number;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Read this org's current-period overage state. The default
   *  implementation (in `usage-reporter.live.ts`) reads from the
   *  Stripe Subscription; tests inject a stub. */
  loadOrgUsageContext: (orgId: string) => Promise<OrgUsageContext | null>;
};

export type OrgUsageContext = {
  /** Stripe Subscription Item id for the overage Price line. Null when
   *  the plan has no overage line (Solo Unlimited, Enterprise) or the
   *  org isn't yet billed. */
  overageSubscriptionItemId: string | null;
  /** Cumulative drafts already reported to Stripe in the current period.
   *  We subtract this to get the delta. Tracked client-side because
   *  Stripe's GET subscription item usage records is paginated + slow. */
  overageReportedSoFar: number;
  /** Start of the current Stripe billing period (UTC). Drives the
   *  drafts-this-period count. */
  currentPeriodStartIso: string;
  /** Active OrgUser count — drives `computeIncludedDrafts` for per-seat
   *  plans. */
  seatCount: number;
};

/**
 * Run the reporter for one org. Pure-ish — all I/O goes through the
 * injected `deps`, so tests can drive every branch without a network.
 */
export async function reportOneOrg(
  orgId: string,
  billingPlan: BillingPlan,
  deps: UsageReporterDeps,
  now: Date = new Date(),
): Promise<UsageReportRow> {
  const start = Date.now();
  const policy = getPlanPolicy(billingPlan);

  // Skip-cohort: unbilled or unlimited plans never get a usage report.
  if (!policy.paid) {
    return baseRow({
      orgId,
      billingPlan,
      status: 'skipped_unbilled',
      durationMs: Date.now() - start,
    });
  }
  if (policy.draftsIncluded === UNLIMITED) {
    return baseRow({
      orgId,
      billingPlan,
      status: 'skipped_unlimited',
      durationMs: Date.now() - start,
    });
  }
  if (policy.overageRateCents === 0) {
    // Defense-in-depth: a paid plan with overage rate 0 (Enterprise
    // contract that uses a custom overage line we don't manage)
    // should never be reported through this codepath.
    return baseRow({
      orgId,
      billingPlan,
      status: 'skipped_unbilled',
      durationMs: Date.now() - start,
    });
  }

  const ctx = await deps.loadOrgUsageContext(orgId);
  if (!ctx) {
    return baseRow({
      orgId,
      billingPlan,
      status: 'skipped_no_subscription',
      durationMs: Date.now() - start,
    });
  }
  if (!ctx.overageSubscriptionItemId) {
    return baseRow({
      orgId,
      billingPlan,
      status: 'skipped_no_overage_item',
      durationMs: Date.now() - start,
    });
  }

  const periodStart = new Date(ctx.currentPeriodStartIso);
  const drafts = await countDistinctDraftsSince(orgId, periodStart);
  const drafts_included = computeIncludedDrafts(billingPlan, ctx.seatCount);
  // drafts_included is never UNLIMITED here (we returned earlier).
  const overage = Math.max(0, drafts - drafts_included);
  const reported_increment = Math.max(0, overage - ctx.overageReportedSoFar);

  if (reported_increment === 0) {
    return baseRow({
      orgId,
      billingPlan,
      drafts,
      drafts_included,
      overage,
      status: 'no_change',
      durationMs: Date.now() - start,
    });
  }

  const idempotencyKey = `${orgId}-${formatYyyymmdd(now)}`;
  const result = await deps.reportToStripe({
    subscriptionItemId: ctx.overageSubscriptionItemId,
    quantity: reported_increment,
    idempotencyKey,
    timestampMs: now.getTime(),
  });

  if (!result.ok) {
    return baseRow({
      orgId,
      billingPlan,
      drafts,
      drafts_included,
      overage,
      reported_increment,
      status: 'failed',
      error: result.error,
      durationMs: Date.now() - start,
    });
  }

  return baseRow({
    orgId,
    billingPlan,
    drafts,
    drafts_included,
    overage,
    reported_increment,
    status: 'reported',
    durationMs: Date.now() - start,
  });
}

/**
 * Count distinct `Note.id`s (= drafts) for an org since `since`. The
 * billing event is `NOTE_GENERATION_COMPLETED` (audited by the
 * ai-generation worker on every successful draft). resourceId IS the
 * noteId. Distinct so a regenerate-section pass doesn't double-bill.
 */
async function countDistinctDraftsSince(
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
 * Run the reporter against every paid org. Each org is independent —
 * a failure on one doesn't bail the others. Returns one result per
 * org for the caller's log shipping.
 */
export async function reportAllOrgs(
  deps: UsageReporterDeps,
  now: Date = new Date(),
): Promise<UsageReportRow[]> {
  const orgs = await prisma.organization.findMany({
    select: { id: true, billingPlan: true },
    where: {
      // Skip the unbilled / unlimited cohort on the SQL side too, so
      // we don't waste a roundtrip on every TRIAL org.
      billingPlan: {
        in: ['SOLO_STARTER', 'SOLO_PRO', 'SOLO_POWER', 'DUO', 'PRACTICE'],
      },
    },
  });
  const results: UsageReportRow[] = [];
  for (const org of orgs) {
    try {
      results.push(await reportOneOrg(org.id, org.billingPlan, deps, now));
    } catch (err) {
      results.push(
        baseRow({
          orgId: org.id,
          billingPlan: org.billingPlan,
          status: 'failed',
          error: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
          durationMs: 0,
        }),
      );
    }
  }
  return results;
}

function baseRow(
  partial: Partial<UsageReportRow> & {
    orgId: string;
    billingPlan: BillingPlan;
    status: UsageReportRow['status'];
    durationMs: number;
  },
): UsageReportRow {
  return {
    drafts: 0,
    drafts_included: 0,
    overage: 0,
    reported_increment: 0,
    ...partial,
  };
}

/** YYYY-MM-DD in UTC — used for the Stripe idempotency key. */
export function formatYyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${d.getUTCDate()}`.padStart(2, '0');
  return `${y}${m}${day}`;
}
