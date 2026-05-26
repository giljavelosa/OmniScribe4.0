import { describe, expect, it } from 'vitest';

import {
  ALL_BILLING_PLANS,
  UNLIMITED,
  canAddSeat,
  computeIncludedDrafts,
  getPlanPolicy,
} from '@/lib/billing/plan-policy';

/**
 * Plan-policy tests — locks in the consumer-facing pricing math.
 *
 * The numbers here MUST match `references/strategic/stripe-pricing-skus.md`.
 * If you change a price tier, update this test in the same PR — these
 * assertions are intentionally hard-coded from the published numbers.
 */

describe('getPlanPolicy — registry coverage', () => {
  it('has a policy registered for every BillingPlan enum value', () => {
    for (const plan of ALL_BILLING_PLANS) {
      const policy = getPlanPolicy(plan);
      expect(policy.label.length).toBeGreaterThan(0);
    }
  });

  it('throws for an unregistered plan (defense against silent mis-charge)', () => {
    expect(() => getPlanPolicy('NOT_A_PLAN' as never)).toThrow(/no policy/i);
  });
});

describe('seat caps + minimums (the anti-credential-sharing wedge)', () => {
  it.each([
    ['TRIAL', 1, 1],
    ['SOLO_STARTER', 1, 1],
    ['SOLO_PRO', 1, 1],
    ['SOLO_POWER', 1, 1],
    ['SOLO_UNLIMITED', 1, 1],
    ['DUO', 2, 2], // anti-sharing wedge — locked at exactly 2
    ['PRACTICE', 49, 3], // 3 seat min, 49 cap before Enterprise
    ['ENTERPRISE', UNLIMITED, 50],
  ] as const)('%s: cap=%d, min=%d', (plan, expectedCap, expectedMin) => {
    const p = getPlanPolicy(plan);
    expect(p.seatCap).toBe(expectedCap);
    expect(p.seatMin).toBe(expectedMin);
  });
});

describe('draft bundles per plan', () => {
  it.each([
    ['TRIAL', 50],
    ['SOLO_STARTER', 60],
    ['SOLO_PRO', 160],
    ['SOLO_POWER', 300],
    ['SOLO_UNLIMITED', UNLIMITED],
    ['DUO', 120],
    ['PRACTICE', 160],
    ['ENTERPRISE', UNLIMITED],
  ] as const)('%s: draftsIncluded=%d', (plan, expected) => {
    expect(getPlanPolicy(plan).draftsIncluded).toBe(expected);
  });
});

describe('overage rates (in cents — published pricing)', () => {
  it.each([
    ['TRIAL', 0],
    ['SOLO_STARTER', 199],
    ['SOLO_PRO', 149],
    ['SOLO_POWER', 129],
    ['SOLO_UNLIMITED', 0],
    ['DUO', 149],
    ['PRACTICE', 149],
    ['ENTERPRISE', 0],
  ] as const)('%s: overageRateCents=%d', (plan, expected) => {
    expect(getPlanPolicy(plan).overageRateCents).toBe(expected);
  });
});

describe('computeIncludedDrafts — flat vs per-seat scaling', () => {
  it('Solo plans return the flat bundle regardless of seat count', () => {
    expect(computeIncludedDrafts('SOLO_PRO', 1)).toBe(160);
    expect(computeIncludedDrafts('SOLO_PRO', 5)).toBe(160); // ignored
  });

  it('Duo multiplies by exactly 2 seats (the cap == min)', () => {
    expect(computeIncludedDrafts('DUO', 2)).toBe(240);
    // Even if the DB has 1 active seat (admin still onboarding),
    // we honor the seatMin floor so the customer gets what they paid for.
    expect(computeIncludedDrafts('DUO', 1)).toBe(240);
  });

  it('Practice multiplies by active seat count', () => {
    expect(computeIncludedDrafts('PRACTICE', 3)).toBe(480); // 3 × 160
    expect(computeIncludedDrafts('PRACTICE', 10)).toBe(1_600);
    // Cap at 49 — even if the DB has 60 rows (data corruption), we
    // bound the bundle to the paid seat count.
    expect(computeIncludedDrafts('PRACTICE', 60)).toBe(49 * 160);
  });

  it('Solo Unlimited and Enterprise return UNLIMITED', () => {
    expect(computeIncludedDrafts('SOLO_UNLIMITED', 1)).toBe(UNLIMITED);
    expect(computeIncludedDrafts('ENTERPRISE', 200)).toBe(UNLIMITED);
  });
});

describe('canAddSeat — the seat-cap gate', () => {
  it('Solo plans refuse a 2nd seat with the upgrade message', () => {
    const result = canAddSeat('SOLO_PRO', 1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toMatch(/solo/i);
    expect(result.reason).toMatch(/duo|practice/i);
    expect(result.suggestPlan).toBe('DUO');
  });

  it('Duo refuses a 3rd seat with the Practice upgrade message', () => {
    const result = canAddSeat('DUO', 2);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toMatch(/practice/i);
    expect(result.suggestPlan).toBe('PRACTICE');
  });

  it('Practice refuses a 50th seat with the Enterprise upgrade message', () => {
    const result = canAddSeat('PRACTICE', 49);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toMatch(/enterprise/i);
    expect(result.suggestPlan).toBe('ENTERPRISE');
  });

  it('Practice allows a 4th seat (under 49 cap)', () => {
    expect(canAddSeat('PRACTICE', 3).ok).toBe(true);
  });

  it('Enterprise always allows another seat', () => {
    expect(canAddSeat('ENTERPRISE', 100).ok).toBe(true);
    expect(canAddSeat('ENTERPRISE', 5_000).ok).toBe(true);
  });

  it('Trial refuses a 2nd seat (forces upgrade before team grows)', () => {
    expect(canAddSeat('TRIAL', 1).ok).toBe(false);
  });
});
