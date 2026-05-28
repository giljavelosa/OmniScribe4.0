/**
 * Org / practice visit-bank pricing from the active catalog enterprise template.
 */

import type { BillingPlan } from '@prisma/client';

import type { EnterpriseTemplateCatalog } from '@/lib/billing/catalog-defaults';

export const ORG_SEAT_COUNT_MAX = 49;

export type OrgMonthlyQuote = {
  seatCount: number;
  seatPriceCents: number;
  visitsPerSeatPerMonth: number;
  monthlyTotalCents: number;
  monthlyVisitCredit: number;
  billingPlan: BillingPlan;
};

export function billingPlanForOrgSeatCount(seatCount: number): BillingPlan {
  if (seatCount <= 1) return 'SOLO_PRO';
  if (seatCount === 2) return 'DUO';
  return 'PRACTICE';
}

export type OrgMonthlyQuoteError = { error: string };

export function quoteOrgMonthlyPlan(
  template: EnterpriseTemplateCatalog,
  seatCount: number,
  minSeats: number,
): OrgMonthlyQuote | OrgMonthlyQuoteError {
  const seats = Math.floor(seatCount);
  if (seats < minSeats) {
    return { error: `Team plans require at least ${minSeats} seats.` };
  }
  if (seats > ORG_SEAT_COUNT_MAX) {
    return {
      error: `Self-serve checkout supports up to ${ORG_SEAT_COUNT_MAX} seats. Contact us for larger orgs.`,
    };
  }

  const seatPriceCents = template.defaultSeatPriceCents;
  const visitsPerSeatPerMonth = template.defaultVisitsPerSeatPerMonth;

  return {
    seatCount: seats,
    seatPriceCents,
    visitsPerSeatPerMonth,
    monthlyTotalCents: seats * seatPriceCents,
    monthlyVisitCredit: seats * visitsPerSeatPerMonth,
    billingPlan: billingPlanForOrgSeatCount(seats),
  };
}
