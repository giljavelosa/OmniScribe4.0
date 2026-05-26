import { describe, expect, it } from 'vitest';

import {
  compareSoloPlans,
  recommendSoloPlan,
} from '@/lib/billing/recommend-plan';
import { UNLIMITED } from '@/lib/billing/plan-policy';

/**
 * Recommendation-helper tests. Locks in the cross-over points from
 * `references/strategic/stripe-pricing-skus.md` so a future tier
 * adjustment that breaks the math fails this test FIRST.
 */

describe('compareSoloPlans — under-bundle for Starter', () => {
  it('30 drafts: Starter cheapest at $99 flat', () => {
    const rows = compareSoloPlans(30);
    expect(rows[0]?.plan).toBe('SOLO_STARTER');
    expect(rows[0]?.totalCostCents).toBe(9_900);
    expect(rows[0]?.overageDrafts).toBe(0);
  });
});

describe('compareSoloPlans — at the Starter→Pro crossover', () => {
  it('100 drafts: Starter w/ 40 overage = $99 + 40×$1.99 = $178.60', () => {
    const rows = compareSoloPlans(100);
    const starter = rows.find((r) => r.plan === 'SOLO_STARTER')!;
    expect(starter.overageDrafts).toBe(40);
    expect(starter.totalCostCents).toBe(9_900 + 40 * 199);
  });

  it('120 drafts: Pro at $179 beats Starter at $99 + 60×$1.99 = $218.40', () => {
    const rows = compareSoloPlans(120);
    expect(rows[0]?.plan).toBe('SOLO_PRO');
  });
});

describe('compareSoloPlans — Pro→Power crossover', () => {
  it('300 drafts: Pro w/ 140 overage = $179 + 140×$1.49 = $387.60 vs Power $299 → Power wins', () => {
    const rows = compareSoloPlans(300);
    expect(rows[0]?.plan).toBe('SOLO_POWER');
  });
});

describe('compareSoloPlans — Power→Unlimited crossover', () => {
  it('500 drafts: Power w/ 200 overage = $299 + 200×$1.29 = $557 vs Unlimited $349 → Unlimited wins', () => {
    const rows = compareSoloPlans(500);
    expect(rows[0]?.plan).toBe('SOLO_UNLIMITED');
  });

  it('Unlimited has UNLIMITED draftsIncluded sentinel + zero overage', () => {
    const rows = compareSoloPlans(1000);
    const unlimited = rows.find((r) => r.plan === 'SOLO_UNLIMITED')!;
    expect(unlimited.draftsIncluded).toBe(UNLIMITED);
    expect(unlimited.overageDrafts).toBe(0);
    expect(unlimited.totalCostCents).toBe(34_900);
  });
});

describe('recommendSoloPlan — single-plan answer', () => {
  it.each([
    [0, 'SOLO_STARTER'],
    [60, 'SOLO_STARTER'],
    [100, 'SOLO_STARTER'], // still cheapest with overage
    [120, 'SOLO_PRO'],
    [200, 'SOLO_PRO'],
    [300, 'SOLO_POWER'],
    [500, 'SOLO_UNLIMITED'],
  ])('drafts=%d → %s', (drafts, expectedPlan) => {
    expect(recommendSoloPlan(drafts).plan).toBe(expectedPlan);
  });
});
