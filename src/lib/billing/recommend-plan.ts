/**
 * Plan-recommendation helper — used by /account/usage to surface
 * "would you have saved money on plan X this month?" math.
 *
 * Pure function; no DB. Takes the org's current monthly draft count
 * and returns the cheapest plan that would have covered it.
 *
 * NOTE: this is a lightweight Solo-only calculator. Practice and Duo
 * recommendations require seat-count context that solo users don't
 * have, so we keep this scoped to the Solo ladder for now.
 */

import { BillingPlan } from '@prisma/client';
import { getPlanPolicy, UNLIMITED } from './plan-policy';

export type PlanCostBreakdown = {
  plan: BillingPlan;
  label: string;
  basePriceCents: number;
  draftsIncluded: number; // UNLIMITED sentinel preserved
  overageDrafts: number;
  overageCostCents: number;
  totalCostCents: number;
};

/** Cents/month base price for each Solo SKU (matches stripe-pricing-skus.md). */
const SOLO_BASE_PRICE_CENTS: Partial<Record<BillingPlan, number>> = {
  SOLO_STARTER: 9900,
  SOLO_PRO: 17900,
  SOLO_POWER: 29900,
  SOLO_UNLIMITED: 34900,
};

const SOLO_PLANS: readonly BillingPlan[] = [
  'SOLO_STARTER',
  'SOLO_PRO',
  'SOLO_POWER',
  'SOLO_UNLIMITED',
];

/**
 * Compute the monthly cost an org WOULD have paid on each Solo plan
 * given a fixed draft count for the period. Returns one row per plan,
 * sorted cheapest first.
 */
export function compareSoloPlans(drafts: number): PlanCostBreakdown[] {
  const rows: PlanCostBreakdown[] = SOLO_PLANS.map((plan) => {
    const policy = getPlanPolicy(plan);
    const basePriceCents = SOLO_BASE_PRICE_CENTS[plan] ?? 0;
    if (policy.draftsIncluded === UNLIMITED) {
      return {
        plan,
        label: policy.label,
        basePriceCents,
        draftsIncluded: UNLIMITED,
        overageDrafts: 0,
        overageCostCents: 0,
        totalCostCents: basePriceCents,
      };
    }
    const overageDrafts = Math.max(0, drafts - policy.draftsIncluded);
    const overageCostCents = overageDrafts * policy.overageRateCents;
    return {
      plan,
      label: policy.label,
      basePriceCents,
      draftsIncluded: policy.draftsIncluded,
      overageDrafts,
      overageCostCents,
      totalCostCents: basePriceCents + overageCostCents,
    };
  });
  rows.sort((a, b) => a.totalCostCents - b.totalCostCents);
  return rows;
}

/**
 * Given a draft count, return the recommended Solo plan (cheapest
 * total cost). Ties broken by smaller bundle first (so a clinician
 * exactly at the boundary doesn't get pushed to a bigger plan they
 * may not need).
 */
export function recommendSoloPlan(drafts: number): PlanCostBreakdown {
  const rows = compareSoloPlans(drafts);
  // compareSoloPlans is already sorted cheapest first; bundle-tiebreak
  // logic: if two rows tie on totalCostCents, prefer the one with the
  // smaller draftsIncluded (more conservative — avoids upselling).
  const cheapest = rows[0]!;
  const tied = rows.filter((r) => r.totalCostCents === cheapest.totalCostCents);
  if (tied.length === 1) return cheapest;
  // Prefer smaller bundle. UNLIMITED treated as Infinity for sorting.
  tied.sort((a, b) => {
    const ai = a.draftsIncluded === UNLIMITED ? Infinity : a.draftsIncluded;
    const bi = b.draftsIncluded === UNLIMITED ? Infinity : b.draftsIncluded;
    return ai - bi;
  });
  return tied[0]!;
}
