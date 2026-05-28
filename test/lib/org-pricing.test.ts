import { describe, expect, it } from 'vitest';

import {
  billingPlanForOrgSeatCount,
  quoteOrgMonthlyPlan,
} from '@/lib/billing/org-pricing';
import type { EnterpriseTemplateCatalog } from '@/lib/billing/catalog-defaults';

const template: EnterpriseTemplateCatalog = {
  defaultSeatPriceCents: 4500,
  defaultVisitsPerSeatPerMonth: 80,
  defaultCommittedSeats: 50,
};

describe('org-pricing', () => {
  it('maps seat count to billing plan', () => {
    expect(billingPlanForOrgSeatCount(1)).toBe('SOLO_PRO');
    expect(billingPlanForOrgSeatCount(2)).toBe('DUO');
    expect(billingPlanForOrgSeatCount(10)).toBe('PRACTICE');
  });

  it('quotes org monthly totals from template', () => {
    const quote = quoteOrgMonthlyPlan(template, 5, 3);
    expect(quote).toMatchObject({
      seatCount: 5,
      seatPriceCents: 4500,
      monthlyTotalCents: 22500,
      monthlyVisitCredit: 400,
      billingPlan: 'PRACTICE',
    });
  });

  it('rejects below minimum seats', () => {
    const result = quoteOrgMonthlyPlan(template, 2, 3);
    expect(result).toEqual({ error: 'Team plans require at least 3 seats.' });
  });

  it('rejects above self-serve max', () => {
    const result = quoteOrgMonthlyPlan(template, 50, 3);
    expect(result).toEqual({
      error: 'Self-serve checkout supports up to 49 seats. Contact us for larger orgs.',
    });
  });
});
