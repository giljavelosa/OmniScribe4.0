import { NextResponse } from 'next/server';

import { requireFeatureAccess } from '@/lib/authz/server';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { isStripeConfigured, getPublicBaseUrl } from '@/lib/stripe/env';
import { getStripe } from '@/lib/stripe/client';

export const runtime = 'nodejs';

/**
 * POST /api/billing/portal — open the Stripe-hosted customer portal so an org
 * admin can update the payment method, change seat quantity, or cancel. Any
 * change made there flows back as a `customer.subscription.updated` webhook.
 *
 * 501 when Stripe is not configured; 400 when the org has no Stripe customer
 * yet (subscribe via /api/billing/checkout first). BILLING_MANAGE-gated.
 */
export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: { code: 'stripe_not_configured' } }, { status: 501 });
  }

  const guard = await requireFeatureAccess('BILLING_MANAGE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const org = await prisma.organization.findUnique({
    where: { id: authorizationUser.orgId },
    select: { id: true, stripeCustomerId: true },
  });
  if (!org) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  if (!org.stripeCustomerId) {
    return NextResponse.json(
      {
        error: {
          code: 'no_stripe_customer',
          message: 'No subscription to manage yet. Start one from the billing page.',
        },
      },
      { status: 400 },
    );
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${getPublicBaseUrl()}/admin/billing`,
  });

  await writeAuditLog({
    userId: user.id,
    orgId: org.id,
    action: 'STRIPE_BILLING_PORTAL_OPENED',
    resourceType: 'Organization',
    resourceId: org.id,
    metadata: {},
  });

  return NextResponse.json({ data: { url: session.url } }, { status: 200 });
}
