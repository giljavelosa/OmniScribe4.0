/**
 * Stripe Checkout fulfillment for visit-bank purchases (Unit 51 PR2).
 */

import type Stripe from 'stripe';
import { CommercialModel } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { creditOrgBank } from '@/lib/billing/visit-ledger';
import { ensureOrganizationCommercialContract } from '@/lib/billing/ensure-contract';
import { billingPlanForSoloTierId } from '@/lib/billing/commercial-mode';

export type CapacityPurchaseMetadata = {
  orgId: string;
  purchaseType: 'visit_bundle' | 'monthly_tier';
  catalogItemId: string;
  visitCredit: string;
};

function parseCapacityMetadata(
  meta: Stripe.Metadata | null | undefined,
): CapacityPurchaseMetadata | null {
  if (!meta?.orgId || !meta.purchaseType) return null;
  if (meta.purchaseType !== 'visit_bundle' && meta.purchaseType !== 'monthly_tier') {
    return null;
  }
  if (!meta.catalogItemId || !meta.visitCredit) return null;
  return {
    orgId: meta.orgId,
    purchaseType: meta.purchaseType,
    catalogItemId: meta.catalogItemId,
    visitCredit: meta.visitCredit,
  };
}

export async function fulfillVisitBundleCheckout(
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  const meta = parseCapacityMetadata(session.metadata);
  if (!meta || meta.purchaseType !== 'visit_bundle') return false;

  const visitCredit = Number(meta.visitCredit);
  if (!Number.isFinite(visitCredit) || visitCredit < 1) return false;

  await ensureOrganizationCommercialContract(meta.orgId);

  const result = await creditOrgBank({
    orgId: meta.orgId,
    amount: visitCredit,
    sourceType: 'BUNDLE_PURCHASE',
    sourceId: session.id,
    idempotencyKey: `checkout-bundle:${session.id}`,
    metadata: {
      bundleId: meta.catalogItemId,
      stripeSessionId: session.id,
    },
  });

  await prisma.organizationCommercialContract.update({
    where: { orgId: meta.orgId },
    data: { commercialModel: CommercialModel.ORG_VISIT_BANK },
  });

  await writeAuditLog({
    orgId: meta.orgId,
    action: 'STRIPE_CAPACITY_FULFILLED',
    resourceType: 'Organization',
    resourceId: meta.orgId,
    metadata: {
      purchaseType: 'visit_bundle',
      catalogItemId: meta.catalogItemId,
      visitCredit,
      orgBankBalance: result.orgBankBalance,
      stripeSessionId: session.id,
    },
  });

  return true;
}

export async function fulfillMonthlyTierCheckout(
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  const meta = parseCapacityMetadata(session.metadata);
  if (!meta || meta.purchaseType !== 'monthly_tier') return false;

  const visitCredit = Number(meta.visitCredit);
  if (!Number.isFinite(visitCredit) || visitCredit < 1) return false;

  await ensureOrganizationCommercialContract(meta.orgId);

  if (typeof session.subscription === 'string') {
    await prisma.organization.update({
      where: { id: meta.orgId },
      data: {
        stripeSubscriptionId: session.subscription,
        billingPlan: billingPlanForSoloTierId(meta.catalogItemId),
      },
    });
  } else {
    await prisma.organization.update({
      where: { id: meta.orgId },
      data: { billingPlan: billingPlanForSoloTierId(meta.catalogItemId) },
    });
  }

  await prisma.organizationCommercialContract.update({
    where: { orgId: meta.orgId },
    data: {
      commercialModel: CommercialModel.SOLO_VISIT_BANK,
      monthlyTierId: meta.catalogItemId,
      capacityEnforcementEnabled: true,
    },
  });

  const result = await creditOrgBank({
    orgId: meta.orgId,
    amount: visitCredit,
    sourceType: 'MONTHLY_ALLOWANCE',
    sourceId: session.id,
    idempotencyKey: `checkout-tier:${session.id}`,
    metadata: {
      tierId: meta.catalogItemId,
      stripeSessionId: session.id,
      kind: 'initial_checkout',
    },
  });

  await writeAuditLog({
    orgId: meta.orgId,
    action: 'STRIPE_CAPACITY_FULFILLED',
    resourceType: 'Organization',
    resourceId: meta.orgId,
    metadata: {
      purchaseType: 'monthly_tier',
      catalogItemId: meta.catalogItemId,
      visitCredit,
      orgBankBalance: result.orgBankBalance,
      stripeSessionId: session.id,
    },
  });

  return true;
}

export async function fulfillMonthlyTierInvoice(invoice: Stripe.Invoice): Promise<boolean> {
  const subId = (invoice as unknown as { subscription?: string | null }).subscription;
  if (typeof subId !== 'string' || !invoice.id) return false;

  const { getStripe } = await import('@/lib/stripe/client');
  const sub = await getStripe().subscriptions.retrieve(subId);
  const meta = parseCapacityMetadata(sub.metadata);
  if (!meta || meta.purchaseType !== 'monthly_tier') return false;

  const visitCredit = Number(meta.visitCredit);
  if (!Number.isFinite(visitCredit) || visitCredit < 1) return false;

  const result = await creditOrgBank({
    orgId: meta.orgId,
    amount: visitCredit,
    sourceType: 'MONTHLY_ALLOWANCE',
    sourceId: invoice.id,
    idempotencyKey: `invoice-tier:${invoice.id}`,
    metadata: {
      tierId: meta.catalogItemId,
      stripeInvoiceId: invoice.id,
      kind: 'subscription_renewal',
    },
  });

  await writeAuditLog({
    orgId: meta.orgId,
    action: 'STRIPE_CAPACITY_FULFILLED',
    resourceType: 'Organization',
    resourceId: meta.orgId,
    metadata: {
      purchaseType: 'monthly_tier_renewal',
      catalogItemId: meta.catalogItemId,
      visitCredit,
      orgBankBalance: result.orgBankBalance,
      stripeInvoiceId: invoice.id,
    },
  });

  return true;
}

export async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.mode === 'payment') {
    await fulfillVisitBundleCheckout(session);
    return;
  }
  if (session.mode === 'subscription') {
    const fulfilled = await fulfillMonthlyTierCheckout(session);
    if (fulfilled) return;
  }
}
