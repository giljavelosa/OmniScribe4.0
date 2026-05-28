import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const creditOrgBank = vi.fn();
const ensureOrganizationCommercialContract = vi.fn();
const writeAuditLog = vi.fn();
const orgUpdate = vi.fn();
const contractUpdate = vi.fn();
const subscriptionsRetrieve = vi.fn();

vi.mock('@/lib/billing/visit-ledger', () => ({
  creditOrgBank: (...args: unknown[]) => creditOrgBank(...args),
}));

vi.mock('@/lib/billing/ensure-contract', () => ({
  ensureOrganizationCommercialContract: (...args: unknown[]) =>
    ensureOrganizationCommercialContract(...args),
}));

vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLog(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: { update: (...args: unknown[]) => orgUpdate(...args) },
    organizationCommercialContract: {
      update: (...args: unknown[]) => contractUpdate(...args),
    },
  },
}));

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    subscriptions: { retrieve: (...args: unknown[]) => subscriptionsRetrieve(...args) },
  }),
}));

import {
  fulfillMonthlyTierCheckout,
  fulfillMonthlyTierInvoice,
  fulfillVisitBundleCheckout,
} from '@/lib/billing/stripe-fulfillment';

function bundleSession(over: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: 'cs_bundle_1',
    mode: 'payment',
    metadata: {
      orgId: 'org_1',
      purchaseType: 'visit_bundle',
      catalogItemId: 'bundle-500',
      visitCredit: '500',
    },
    ...over,
  } as Stripe.Checkout.Session;
}

function tierSession(over: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: 'cs_tier_1',
    mode: 'subscription',
    subscription: 'sub_1',
    metadata: {
      orgId: 'org_1',
      purchaseType: 'monthly_tier',
      catalogItemId: 'solo-standard',
      visitCredit: '100',
    },
    ...over,
  } as Stripe.Checkout.Session;
}

beforeEach(() => {
  creditOrgBank.mockReset().mockResolvedValue({ orgBankBalance: 600 });
  ensureOrganizationCommercialContract.mockReset().mockResolvedValue({});
  writeAuditLog.mockReset().mockResolvedValue(undefined);
  orgUpdate.mockReset().mockResolvedValue({});
  contractUpdate.mockReset().mockResolvedValue({});
  subscriptionsRetrieve.mockReset();
});

describe('fulfillVisitBundleCheckout', () => {
  it('credits org bank and audits bundle fulfillment', async () => {
    const ok = await fulfillVisitBundleCheckout(bundleSession());
    expect(ok).toBe(true);
    expect(creditOrgBank).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        amount: 500,
        idempotencyKey: 'checkout-bundle:cs_bundle_1',
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STRIPE_CAPACITY_FULFILLED' }),
    );
  });

  it('returns false when metadata is incomplete', async () => {
    const ok = await fulfillVisitBundleCheckout(
      bundleSession({ metadata: { orgId: 'org_1', purchaseType: 'visit_bundle' } }),
    );
    expect(ok).toBe(false);
    expect(creditOrgBank).not.toHaveBeenCalled();
  });

  it('uses idempotency key so repeat fulfillment is safe at ledger layer', async () => {
    await fulfillVisitBundleCheckout(bundleSession());
    expect(creditOrgBank.mock.calls[0]?.[0]?.idempotencyKey).toBe(
      'checkout-bundle:cs_bundle_1',
    );
  });
});

describe('fulfillMonthlyTierCheckout', () => {
  it('links subscription, updates contract, and credits initial visits', async () => {
    const ok = await fulfillMonthlyTierCheckout(tierSession());
    expect(ok).toBe(true);
    expect(orgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org_1' },
        data: { stripeSubscriptionId: 'sub_1', billingPlan: 'SOLO_PRO' },
      }),
    );
    expect(contractUpdate).toHaveBeenCalled();
    expect(creditOrgBank).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 100,
        idempotencyKey: 'checkout-tier:cs_tier_1',
      }),
    );
  });
});

describe('fulfillMonthlyTierInvoice', () => {
  it('credits renewal visits from subscription metadata', async () => {
    subscriptionsRetrieve.mockResolvedValue({
      metadata: {
        orgId: 'org_1',
        purchaseType: 'monthly_tier',
        catalogItemId: 'solo-standard',
        visitCredit: '100',
      },
    });

    const ok = await fulfillMonthlyTierInvoice({
      id: 'in_1',
      subscription: 'sub_1',
    } as unknown as Stripe.Invoice);

    expect(ok).toBe(true);
    expect(creditOrgBank).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 100,
        idempotencyKey: 'invoice-tier:in_1',
      }),
    );
  });

  it('returns false when invoice has no subscription id', async () => {
    const ok = await fulfillMonthlyTierInvoice({ id: 'in_2' } as unknown as Stripe.Invoice);
    expect(ok).toBe(false);
  });
});
