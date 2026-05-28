import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const creditOrgBank = vi.fn();
const ensureOrganizationCommercialContract = vi.fn();
const writeAuditLog = vi.fn();
const orgUpdate = vi.fn();
const orgFindUnique = vi.fn();
const contractUpdate = vi.fn();
const contractFindUniqueOrThrow = vi.fn();
const subscriptionsRetrieve = vi.fn();

vi.mock('@/lib/billing/catalog-resolver', () => ({
  getActiveCatalogPayload: vi.fn().mockResolvedValue({
    payload: {
      enterpriseTemplateJson: {
        defaultSeatPriceCents: 4500,
        defaultVisitsPerSeatPerMonth: 80,
        defaultCommittedSeats: 50,
      },
      trialOrgSeats: 3,
    },
  }),
}));

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
    organization: {
      update: (...args: unknown[]) => orgUpdate(...args),
      findUnique: (...args: unknown[]) => orgFindUnique(...args),
    },
    organizationCommercialContract: {
      update: (...args: unknown[]) => contractUpdate(...args),
      findUniqueOrThrow: (...args: unknown[]) => contractFindUniqueOrThrow(...args),
      findUnique: vi.fn().mockResolvedValue({ committedSeats: 5 }),
    },
  },
}));

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    subscriptions: { retrieve: (...args: unknown[]) => subscriptionsRetrieve(...args) },
  }),
}));

import {
  fulfillCollaboratorSeatsCheckout,
  fulfillMonthlyTierCheckout,
  fulfillMonthlyTierInvoice,
  fulfillOrgMonthlyTierCheckout,
  fulfillVisitBundleCheckout,
  handleCapacitySubscriptionDeleted,
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
  orgFindUnique.mockReset().mockResolvedValue({ stripeSubscriptionId: 'sub_1' });
  contractUpdate.mockReset().mockResolvedValue({});
  contractFindUniqueOrThrow.mockReset().mockResolvedValue({ committedSeats: 5 });
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

function orgTierSession(over: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: 'cs_org_1',
    mode: 'subscription',
    subscription: 'sub_org_1',
    metadata: {
      orgId: 'org_1',
      purchaseType: 'org_monthly_tier',
      catalogItemId: 'org-monthly',
      visitCredit: '240',
      seatCount: '3',
    },
    ...over,
  } as Stripe.Checkout.Session;
}

describe('fulfillOrgMonthlyTierCheckout', () => {
  it('sets org contract seats and credits visits', async () => {
    const ok = await fulfillOrgMonthlyTierCheckout(orgTierSession());
    expect(ok).toBe(true);
    expect(orgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ billingPlan: 'PRACTICE' }),
      }),
    );
    expect(contractUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commercialModel: 'ORG_VISIT_BANK',
          committedSeats: 3,
        }),
      }),
    );
    expect(creditOrgBank).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 240,
        idempotencyKey: 'checkout-org-tier:cs_org_1',
      }),
    );
  });
});

describe('fulfillCollaboratorSeatsCheckout', () => {
  it('increases committed seats by addon quantity', async () => {
    contractFindUniqueOrThrow.mockResolvedValue({ committedSeats: 5 });
    const ok = await fulfillCollaboratorSeatsCheckout({
      id: 'cs_collab_1',
      mode: 'subscription',
      metadata: {
        orgId: 'org_1',
        purchaseType: 'collaborator_seats',
        catalogItemId: 'collaborator-seat',
        visitCredit: '0',
        seatAddonQuantity: '2',
      },
    } as unknown as Stripe.Checkout.Session);
    expect(ok).toBe(true);
    expect(contractUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { commercialModel: 'ORG_VISIT_BANK', committedSeats: 7 },
      }),
    );
  });
});

describe('handleCapacitySubscriptionDeleted', () => {
  it('clears capacity subscription and ends trial window on org tier cancel', async () => {
    orgFindUnique.mockResolvedValue({ stripeSubscriptionId: 'sub_org_1' });

    const ok = await handleCapacitySubscriptionDeleted({
      id: 'sub_org_1',
      metadata: {
        orgId: 'org_1',
        purchaseType: 'org_monthly_tier',
        catalogItemId: 'org-monthly',
        visitCredit: '240',
        seatCount: '3',
      },
      items: { data: [] },
    } as unknown as Stripe.Subscription);

    expect(ok).toBe(true);
    expect(orgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { stripeSubscriptionId: null },
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STRIPE_SUBSCRIPTION_CANCELED' }),
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
