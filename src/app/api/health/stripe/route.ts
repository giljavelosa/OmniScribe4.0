import { NextResponse } from 'next/server';

import { requireFeatureAccess } from '@/lib/authz/server';
import { prisma } from '@/lib/prisma';
import { isStripeConfigured, getPublicBaseUrl } from '@/lib/stripe/env';

export const runtime = 'nodejs';

/**
 * GET /api/health/stripe — org-scoped Stripe self-check for org admins.
 *
 * Returns a PHI-free snapshot of this org's Stripe state so a billing admin
 * can verify "is checkout / webhook / seat provisioning working for MY org
 * right now?" without shelling into prod, running SQL, or opening the
 * Stripe dashboard. Pairs with the cross-org / DB-direct CLI counterpart at
 * scripts/check-stripe-prod.ts.
 *
 * Read-only — no audit row written. The surface is meant to be polled
 * freely (e.g. by an ops dashboard widget) and auditing every poll would
 * just be noise.
 *
 * BILLING_MANAGE-gated (ORG_ADMIN). Returns the full shape even when Stripe
 * isn't configured — `configured: false` is itself a useful signal, and the
 * other fields stay accurate (e.g. an org could have a legacy
 * stripeCustomerId from a previous deploy).
 */
export async function GET(req: Request) {
  const guard = await requireFeatureAccess('BILLING_MANAGE', req);
  if ('error' in guard) return guard.error;
  const orgId = guard.authorizationUser.orgId;

  const configured = isStripeConfigured();
  const publicBaseUrl = getPublicBaseUrl();

  const [org, seatGroups, assignedSeats, lastWebhook, lastCheckout, lastPaymentFailed] =
    await Promise.all([
      prisma.organization.findUnique({
        where: { id: orgId },
        select: { stripeCustomerId: true },
      }),
      prisma.seat.groupBy({
        by: ['isActive'],
        where: { orgId },
        _count: { _all: true },
      }),
      prisma.orgUser.count({
        where: { orgId, seatId: { not: null } },
      }),
      // Webhook-driven events — proves Stripe is talking to us. We only count
      // SUBSCRIPTION_UPDATED / CANCELED here because PAYMENT_FAILED is also
      // webhook-driven but is treated as a separate signal below.
      prisma.auditLog.findFirst({
        where: {
          orgId,
          action: { in: ['STRIPE_SUBSCRIPTION_UPDATED', 'STRIPE_SUBSCRIPTION_CANCELED'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, action: true },
      }),
      prisma.auditLog.findFirst({
        where: { orgId, action: 'STRIPE_CHECKOUT_STARTED' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.auditLog.findFirst({
        where: { orgId, action: 'STRIPE_PAYMENT_FAILED' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

  const active = seatGroups.find((g) => g.isActive)?._count._all ?? 0;
  const inactive = seatGroups.find((g) => !g.isActive)?._count._all ?? 0;

  return NextResponse.json({
    data: {
      configured,
      publicBaseUrl,
      hasCustomer: !!org?.stripeCustomerId,
      seats: { active, inactive, assigned: assignedSeats },
      lastWebhookAt: lastWebhook?.createdAt.toISOString() ?? null,
      lastWebhookAction: lastWebhook?.action ?? null,
      lastCheckoutAt: lastCheckout?.createdAt.toISOString() ?? null,
      lastPaymentFailedAt: lastPaymentFailed?.createdAt.toISOString() ?? null,
    },
  });
}
