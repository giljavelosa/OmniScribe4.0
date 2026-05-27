/**
 * Plan policy — single source of truth for the per-BillingPlan invariants
 * the rest of the app reads (seat caps, bundled drafts, overage rates).
 *
 * Why a registry, not scattered conditionals
 * ------------------------------------------
 * Seat caps + draft bundles drift if they live in three places. Every
 * route that needs "how many seats does this plan allow?" or "is this
 * draft an overage?" reads from `getPlanPolicy(plan)`. Adding a new
 * plan = adding one row here + one row in `references/strategic/
 * stripe-pricing-skus.md`. If the values disagree, the test for this
 * file fails.
 *
 * The values here are the "published" ones from the pricing doc. The
 * Stripe Product `metadata.billingPlan` carries them too so a Stripe-
 * side mistake (a Product with the wrong included quantity) can be
 * detected by webhook validation before it bills anyone wrong.
 */

import { BillingPlan } from '@prisma/client';

/** Sentinel for unlimited seats / drafts. */
export const UNLIMITED = -1 as const;

export type PlanPolicy = {
  /** Display name used in /account/usage + admin UI. */
  label: string;
  /** Maximum number of OrgUser rows that can be active under this plan.
   *  `UNLIMITED` for Practice + Enterprise (Practice's Stripe Product
   *  bands cap at 49 seats; above that → Enterprise contract). */
  seatCap: number;
  /** Minimum seat count enforced at admin time. Trial = 1 (just the
   *  org admin who signed up); Duo = 2 (the wedge); Practice = 3. */
  seatMin: number;
  /** Per-billing-period draft bundle, applied per seat for tiers that
   *  multiply (DUO, PRACTICE) and as a flat number for Solo tiers.
   *  `UNLIMITED` for Solo Unlimited + Enterprise. */
  draftsIncluded: number;
  /** Whether `draftsIncluded` is multiplied by seat count. */
  draftsScaleBySeat: boolean;
  /** Overage cost in USD cents — what we report to Stripe as the
   *  per-unit price on the metered overage line. 0 for unlimited
   *  plans (no overage line) and Trial (no billing). */
  overageRateCents: number;
  /** True when this plan is a real paid tier (drives usage reporting,
   *  billing dashboards, etc.). False for TRIAL. */
  paid: boolean;
  /** True when this plan is a per-seat product. Drives the admin UI's
   *  "add user → automatic seat add" flow vs the Solo "buy a Solo
   *  plan to add users" message. */
  perSeat: boolean;
};

const POLICIES: Record<BillingPlan, PlanPolicy> = {
  TRIAL: {
    label: 'Trial',
    seatCap: 1,
    seatMin: 1,
    // Trial gets a generous-but-bounded slice so a 14-day evaluation
    // covers a typical clinician's intake-week workload.
    draftsIncluded: 50,
    draftsScaleBySeat: false,
    overageRateCents: 0,
    paid: false,
    perSeat: false,
  },
  SOLO_STARTER: {
    label: 'Solo Starter',
    seatCap: 1,
    seatMin: 1,
    draftsIncluded: 60,
    draftsScaleBySeat: false,
    overageRateCents: 199,
    paid: true,
    perSeat: false,
  },
  SOLO_PRO: {
    label: 'Solo Pro',
    seatCap: 1,
    seatMin: 1,
    draftsIncluded: 160,
    draftsScaleBySeat: false,
    overageRateCents: 149,
    paid: true,
    perSeat: false,
  },
  SOLO_POWER: {
    label: 'Solo Power',
    seatCap: 1,
    seatMin: 1,
    draftsIncluded: 300,
    draftsScaleBySeat: false,
    overageRateCents: 129,
    paid: true,
    perSeat: false,
  },
  SOLO_UNLIMITED: {
    label: 'Solo Unlimited',
    seatCap: 1,
    seatMin: 1,
    draftsIncluded: UNLIMITED,
    draftsScaleBySeat: false,
    overageRateCents: 0, // no overage line — unlimited
    paid: true,
    perSeat: false,
  },
  DUO: {
    label: 'Duo',
    // Duo is the anti-credential-sharing wedge — locked at exactly 2
    // seats. seatMin === seatCap means the admin can't downgrade to 1
    // (which would defeat the purpose) and can't upgrade to 3 (which
    // would game the per-seat discount vs Practice).
    seatCap: 2,
    seatMin: 2,
    draftsIncluded: 120,
    draftsScaleBySeat: true,
    overageRateCents: 149,
    paid: true,
    perSeat: true,
  },
  PRACTICE: {
    label: 'Practice',
    // Stripe-side enforced via the 3 volume-band Products (3-9 / 10-24
    // / 25-49). The application-layer cap stops at 49 — above that, the
    // org needs an Enterprise contract.
    seatCap: 49,
    seatMin: 3,
    draftsIncluded: 160,
    draftsScaleBySeat: true,
    // Volume-band-dependent — the 10-24 + 25-49 bands actually have
    // overage at 129 cents. That's encoded by the Stripe Price ID, not
    // here; this constant is the worst-case (small-band) value the
    // app surfaces in error messages. The actual billed overage flows
    // from the Stripe Subscription's overage Price.
    overageRateCents: 149,
    paid: true,
    perSeat: true,
  },
  ENTERPRISE: {
    label: 'Enterprise',
    seatCap: UNLIMITED,
    seatMin: 50,
    draftsIncluded: UNLIMITED,
    draftsScaleBySeat: false,
    overageRateCents: 0, // contract-defined
    paid: true,
    perSeat: true,
  },
};

/** Lookup the policy for a BillingPlan. Throws if the plan has no
 *  registered policy — which is intentional: adding a BillingPlan
 *  enum value without updating this registry should be a compile-
 *  time + load-time error, not a silent mis-charge. */
export function getPlanPolicy(plan: BillingPlan): PlanPolicy {
  const policy = POLICIES[plan];
  if (!policy) {
    throw new Error(`getPlanPolicy: no policy registered for "${plan}"`);
  }
  return policy;
}

/**
 * Compute the bundled draft count for an org given its plan + current
 * seat count. Solo plans are flat; per-seat plans multiply. Unlimited
 * plans return `UNLIMITED` (callers must check vs the sentinel).
 */
export function computeIncludedDrafts(
  plan: BillingPlan,
  seatCount: number,
): number {
  const policy = getPlanPolicy(plan);
  if (policy.draftsIncluded === UNLIMITED) return UNLIMITED;
  if (!policy.draftsScaleBySeat) return policy.draftsIncluded;
  // Per-seat plans multiply by ACTIVE seat count, capped at the seat
  // ceiling (a Practice org with 60 active rows would otherwise bill
  // for 60 × 160 drafts even though Stripe only knows about 49 paid
  // seats).
  const effectiveSeats =
    policy.seatCap === UNLIMITED
      ? seatCount
      : Math.min(seatCount, policy.seatCap);
  return policy.draftsIncluded * Math.max(policy.seatMin, effectiveSeats);
}

/**
 * Decide whether an org with `currentSeatCount` is permitted to invite
 * one more user under its current plan. Returns null on success or an
 * error reason the admin UI can surface verbatim.
 */
export function canAddSeat(
  plan: BillingPlan,
  currentSeatCount: number,
): { ok: true } | { ok: false; reason: string; suggestPlan?: BillingPlan } {
  const policy = getPlanPolicy(plan);
  if (policy.seatCap === UNLIMITED) return { ok: true };
  if (currentSeatCount < policy.seatCap) return { ok: true };

  // At-cap. Suggest the next-larger tier in the human-readable error.
  switch (plan) {
    case 'TRIAL':
    case 'SOLO_STARTER':
    case 'SOLO_PRO':
    case 'SOLO_POWER':
    case 'SOLO_UNLIMITED':
      return {
        ok: false,
        reason:
          'Solo plans are limited to one clinician. Upgrade to Duo (2 seats) or Practice (3+ seats) to add team members.',
        suggestPlan: 'DUO',
      };
    case 'DUO':
      return {
        ok: false,
        reason:
          'Duo is limited to exactly 2 seats. Upgrade to Practice to add a 3rd clinician.',
        suggestPlan: 'PRACTICE',
      };
    case 'PRACTICE':
      return {
        ok: false,
        reason:
          'Practice plans top out at 49 seats. Talk to sales about an Enterprise contract for larger teams.',
        suggestPlan: 'ENTERPRISE',
      };
    case 'ENTERPRISE':
      // Should never hit (UNLIMITED).
      return { ok: true } as never;
  }
}

/**
 * Convenience — every BillingPlan, ordered for UI rendering. Useful
 * for /admin/billing dropdowns + the /owner/pricing-insights overview.
 */
export const ALL_BILLING_PLANS: readonly BillingPlan[] = [
  'TRIAL',
  'SOLO_STARTER',
  'SOLO_PRO',
  'SOLO_POWER',
  'SOLO_UNLIMITED',
  'DUO',
  'PRACTICE',
  'ENTERPRISE',
] as const;
