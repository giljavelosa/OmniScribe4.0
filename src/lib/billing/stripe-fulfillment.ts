/**
 * Stripe Checkout fulfillment for visit-bank purchases (Unit 51 PR2 + Group C).
 */

import type Stripe from 'stripe';
import { CommercialModel } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { creditOrgBank } from '@/lib/billing/visit-ledger';
import {
  ensureOrganizationCommercialContract,
} from '@/lib/billing/ensure-contract';
import { billingPlanForSoloTierId } from '@/lib/billing/commercial-mode';
import { getActiveCatalogPayload } from '@/lib/billing/catalog-resolver';
import { quoteOrgMonthlyPlan } from '@/lib/billing/org-pricing';

export type CapacityPurchaseType =
  | 'visit_bundle'
  | 'monthly_tier'
  | 'org_monthly_tier'
  | 'collaborator_seats';

export type CapacityPurchaseMetadata = {
  orgId: string;
  purchaseType: CapacityPurchaseType;
  catalogItemId: string;
  visitCredit: string;
  seatCount?: string;
  seatAddonQuantity?: string;
};

const CAPACITY_PURCHASE_TYPES: CapacityPurchaseType[] = [
  'visit_bundle',
  'monthly_tier',
  'org_monthly_tier',
  'collaborator_seats',
];

function parseCapacityMetadata(
  meta: Stripe.Metadata | null | undefined,
): CapacityPurchaseMetadata | null {
  if (!meta?.orgId || !meta.purchaseType) return null;
  if (!CAPACITY_PURCHASE_TYPES.includes(meta.purchaseType as CapacityPurchaseType)) {
    return null;
  }
  const purchaseType = meta.purchaseType as CapacityPurchaseType;

  if (purchaseType === 'collaborator_seats') {
    if (!meta.seatAddonQuantity) return null;
    return {
      orgId: meta.orgId,
      purchaseType,
      catalogItemId: meta.catalogItemId ?? 'collaborator-seat',
      visitCredit: meta.visitCredit ?? '0',
      seatAddonQuantity: meta.seatAddonQuantity,
    };
  }

  if (purchaseType === 'org_monthly_tier') {
    if (!meta.seatCount || !meta.visitCredit) return null;
    return {
      orgId: meta.orgId,
      purchaseType,
      catalogItemId: meta.catalogItemId ?? 'org-monthly',
      visitCredit: meta.visitCredit,
      seatCount: meta.seatCount,
    };
  }

  if (!meta.catalogItemId || !meta.visitCredit) return null;
  return {
    orgId: meta.orgId,
    purchaseType,
    catalogItemId: meta.catalogItemId,
    visitCredit: meta.visitCredit,
  };
}

function parseVisitCredit(meta: CapacityPurchaseMetadata): number | null {
  const visitCredit = Number(meta.visitCredit);
  if (!Number.isFinite(visitCredit) || visitCredit < 0) return null;
  return visitCredit;
}

export async function fulfillVisitBundleCheckout(
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  const meta = parseCapacityMetadata(session.metadata);
  if (!meta || meta.purchaseType !== 'visit_bundle') return false;

  const visitCredit = parseVisitCredit(meta);
  if (visitCredit === null || visitCredit < 1) return false;

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

  const visitCredit = parseVisitCredit(meta);
  if (visitCredit === null || visitCredit < 1) return false;

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
      committedSeats: 1,
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

export async function fulfillOrgMonthlyTierCheckout(
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  const meta = parseCapacityMetadata(session.metadata);
  if (!meta || meta.purchaseType !== 'org_monthly_tier') return false;

  const seatCount = Number(meta.seatCount);
  const visitCredit = parseVisitCredit(meta);
  if (!Number.isFinite(seatCount) || seatCount < 1 || visitCredit === null || visitCredit < 1) {
    return false;
  }

  const { payload } = await getActiveCatalogPayload();
  const quote = quoteOrgMonthlyPlan(
    payload.enterpriseTemplateJson,
    seatCount,
    payload.trialOrgSeats,
  );
  if ('error' in quote) return false;

  await ensureOrganizationCommercialContract(meta.orgId);

  if (typeof session.subscription === 'string') {
    await prisma.organization.update({
      where: { id: meta.orgId },
      data: {
        stripeSubscriptionId: session.subscription,
        billingPlan: quote.billingPlan,
      },
    });
  } else {
    await prisma.organization.update({
      where: { id: meta.orgId },
      data: { billingPlan: quote.billingPlan },
    });
  }

  await prisma.organizationCommercialContract.update({
    where: { orgId: meta.orgId },
    data: {
      commercialModel: CommercialModel.ORG_VISIT_BANK,
      committedSeats: quote.seatCount,
      seatPriceCents: quote.seatPriceCents,
      visitsPerSeatPerMonth: quote.visitsPerSeatPerMonth,
      monthlyTierId: null,
      capacityEnforcementEnabled: true,
      trialEndsAt: null,
    },
  });

  const result = await creditOrgBank({
    orgId: meta.orgId,
    amount: visitCredit,
    sourceType: 'MONTHLY_ALLOWANCE',
    sourceId: session.id,
    idempotencyKey: `checkout-org-tier:${session.id}`,
    metadata: {
      seatCount: quote.seatCount,
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
      purchaseType: 'org_monthly_tier',
      seatCount: quote.seatCount,
      visitCredit,
      orgBankBalance: result.orgBankBalance,
      stripeSessionId: session.id,
    },
  });

  return true;
}

export async function fulfillCollaboratorSeatsCheckout(
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  const meta = parseCapacityMetadata(session.metadata);
  if (!meta || meta.purchaseType !== 'collaborator_seats') return false;

  const addonQty = Number(meta.seatAddonQuantity);
  if (!Number.isFinite(addonQty) || addonQty < 1) return false;

  await ensureOrganizationCommercialContract(meta.orgId);

  const contract = await prisma.organizationCommercialContract.findUniqueOrThrow({
    where: { orgId: meta.orgId },
    select: { committedSeats: true },
  });

  await prisma.organizationCommercialContract.update({
    where: { orgId: meta.orgId },
    data: {
      commercialModel: CommercialModel.ORG_VISIT_BANK,
      committedSeats: contract.committedSeats + addonQty,
    },
  });

  await writeAuditLog({
    orgId: meta.orgId,
    action: 'STRIPE_CAPACITY_FULFILLED',
    resourceType: 'Organization',
    resourceId: meta.orgId,
    metadata: {
      purchaseType: 'collaborator_seats',
      seatAddonQuantity: addonQty,
      committedSeatsAfter: contract.committedSeats + addonQty,
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
  if (!meta) return false;

  if (meta.purchaseType === 'collaborator_seats') {
    // Seat add-on renewals do not grant visit credits.
    return true;
  }

  if (meta.purchaseType !== 'monthly_tier' && meta.purchaseType !== 'org_monthly_tier') {
    return false;
  }

  const visitCredit = parseVisitCredit(meta);
  if (visitCredit === null || visitCredit < 1) return false;

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
      purchaseType: meta.purchaseType,
    },
  });

  await writeAuditLog({
    orgId: meta.orgId,
    action: 'STRIPE_CAPACITY_FULFILLED',
    resourceType: 'Organization',
    resourceId: meta.orgId,
    metadata: {
      purchaseType: `${meta.purchaseType}_renewal`,
      catalogItemId: meta.catalogItemId,
      visitCredit,
      orgBankBalance: result.orgBankBalance,
      stripeInvoiceId: invoice.id,
    },
  });

  return true;
}

export async function handleCapacitySubscriptionUpdated(
  sub: Stripe.Subscription,
): Promise<boolean> {
  const meta = parseCapacityMetadata(sub.metadata);
  if (!meta) return false;

  if (meta.purchaseType === 'org_monthly_tier') {
    const lineQty = sub.items.data[0]?.quantity ?? Number(meta.seatCount);
    if (!lineQty || lineQty < 1) return false;

    const { payload } = await getActiveCatalogPayload();
    const quote = quoteOrgMonthlyPlan(
      payload.enterpriseTemplateJson,
      lineQty,
      payload.trialOrgSeats,
    );
    if ('error' in quote) return false;

    await prisma.organization.update({
      where: { id: meta.orgId },
      data: { billingPlan: quote.billingPlan },
    });

    await prisma.organizationCommercialContract.update({
      where: { orgId: meta.orgId },
      data: {
        committedSeats: quote.seatCount,
        seatPriceCents: quote.seatPriceCents,
        visitsPerSeatPerMonth: quote.visitsPerSeatPerMonth,
      },
    });

    await writeAuditLog({
      orgId: meta.orgId,
      action: 'STRIPE_SUBSCRIPTION_UPDATED',
      resourceType: 'Organization',
      resourceId: meta.orgId,
      metadata: {
        purchaseType: meta.purchaseType,
        stripeSubId: sub.id,
        seatCount: quote.seatCount,
        status: sub.status,
      },
    });

    return true;
  }

  if (meta.purchaseType === 'collaborator_seats') {
    const addonQty = sub.items.data[0]?.quantity ?? Number(meta.seatAddonQuantity);
    if (!addonQty || addonQty < 1) return false;

    const contract = await prisma.organizationCommercialContract.findUnique({
      where: { orgId: meta.orgId },
      select: { committedSeats: true },
    });
    if (!contract) return false;

    // Base seats are stored at signup/subscribe; addon sub quantity maps to extra seats.
    const baseSeats = Math.max(1, contract.committedSeats - addonQty);
    await prisma.organizationCommercialContract.update({
      where: { orgId: meta.orgId },
      data: { committedSeats: baseSeats + addonQty },
    });

    await writeAuditLog({
      orgId: meta.orgId,
      action: 'STRIPE_SUBSCRIPTION_UPDATED',
      resourceType: 'Organization',
      resourceId: meta.orgId,
      metadata: {
        purchaseType: meta.purchaseType,
        stripeSubId: sub.id,
        seatAddonQuantity: addonQty,
        status: sub.status,
      },
    });

    return true;
  }

  return false;
}

export async function handleCapacitySubscriptionDeleted(
  sub: Stripe.Subscription,
): Promise<boolean> {
  const meta = parseCapacityMetadata(sub.metadata);
  if (!meta) return false;

  if (meta.purchaseType === 'monthly_tier' || meta.purchaseType === 'org_monthly_tier') {
    const org = await prisma.organization.findUnique({
      where: { id: meta.orgId },
      select: { stripeSubscriptionId: true },
    });
    if (org?.stripeSubscriptionId === sub.id) {
      await prisma.organization.update({
        where: { id: meta.orgId },
        data: { stripeSubscriptionId: null },
      });
    }

    await prisma.organizationCommercialContract.update({
      where: { orgId: meta.orgId },
      data: {
        commercialModel: CommercialModel.TRIAL,
        trialEndsAt: new Date(),
        monthlyTierId: null,
      },
    });

    await writeAuditLog({
      orgId: meta.orgId,
      action: 'STRIPE_SUBSCRIPTION_CANCELED',
      resourceType: 'Organization',
      resourceId: meta.orgId,
      metadata: {
        purchaseType: meta.purchaseType,
        stripeSubId: sub.id,
        capacitySubscription: true,
      },
    });

    return true;
  }

  if (meta.purchaseType === 'collaborator_seats') {
    const addonQty = Number(meta.seatAddonQuantity ?? sub.items.data[0]?.quantity ?? 0);
    if (addonQty > 0) {
      const contract = await prisma.organizationCommercialContract.findUnique({
        where: { orgId: meta.orgId },
        select: { committedSeats: true },
      });
      if (contract) {
        await prisma.organizationCommercialContract.update({
          where: { orgId: meta.orgId },
          data: {
            committedSeats: Math.max(1, contract.committedSeats - addonQty),
          },
        });
      }
    }

    await writeAuditLog({
      orgId: meta.orgId,
      action: 'STRIPE_SUBSCRIPTION_CANCELED',
      resourceType: 'Organization',
      resourceId: meta.orgId,
      metadata: {
        purchaseType: meta.purchaseType,
        stripeSubId: sub.id,
        seatAddonQuantity: addonQty,
        capacitySubscription: true,
      },
    });

    return true;
  }

  return false;
}

export async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.mode === 'payment') {
    await fulfillVisitBundleCheckout(session);
    return;
  }
  if (session.mode === 'subscription') {
    const fulfilled =
      (await fulfillMonthlyTierCheckout(session)) ||
      (await fulfillOrgMonthlyTierCheckout(session)) ||
      (await fulfillCollaboratorSeatsCheckout(session));
    if (fulfilled) return;
  }
}
