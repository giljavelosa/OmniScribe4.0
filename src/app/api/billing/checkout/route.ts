import { NextResponse } from 'next/server';

import { requireFeatureAccess } from '@/lib/authz/server';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { isStripeConfigured, getPublicBaseUrl } from '@/lib/stripe/env';
import { getStripe, PRICE_IDS } from '@/lib/stripe/client';

export const runtime = 'nodejs';

/**
 * POST /api/billing/checkout — start a Stripe Checkout session for a seat
 * subscription.
 *
 * Body: { tier: 'SOLO' | 'TEAM', quantity?: number }. SOLO is forced to a
 * single seat; TEAM takes the requested quantity (clamped 1–500). Returns the
 * hosted Checkout URL — the client redirects the browser there.
 *
 * No Seat rows are created here. Seats are provisioned by the Stripe webhook
 * after `checkout.session.completed` (see src/app/api/webhooks/stripe). The
 * one DB write is persisting a newly-created Stripe customer id.
 *
 * 501 when Stripe is not configured; BILLING_MANAGE-gated (ORG_ADMIN).
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
    select: { id: true, name: true, billingEmail: true, stripeCustomerId: true },
  });
  if (!org) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as
    | { tier?: unknown; quantity?: unknown }
    | null;
  const tier = body?.tier;
  if (tier !== 'SOLO' && tier !== 'TEAM') {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'tier must be SOLO or TEAM.' } },
      { status: 400 },
    );
  }
  const requested = typeof body?.quantity === 'number' ? body.quantity : 1;
  const quantity = tier === 'TEAM' ? Math.max(1, Math.min(500, Math.floor(requested))) : 1;

  const stripe = getStripe();

  // Resolve (or lazily create) the org's Stripe customer.
  let customerId = org.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: org.billingEmail,
      name: org.name,
      metadata: { orgId: org.id },
    });
    customerId = customer.id;
    await prisma.organization.update({
      where: { id: org.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const baseUrl = getPublicBaseUrl();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: tier === 'SOLO' ? PRICE_IDS.SOLO : PRICE_IDS.TEAM, quantity }],
    // The webhook reads sub.metadata.orgId to map the subscription back to an
    // org — without this stamp, reconcileSeats cannot provision any seats.
    subscription_data: { metadata: { orgId: org.id, tier } },
    metadata: { orgId: org.id, tier, quantity: String(quantity) },
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    success_url: `${baseUrl}/admin/billing?checkout=success`,
    cancel_url: `${baseUrl}/admin/billing?checkout=cancelled`,
  });

  await writeAuditLog({
    userId: user.id,
    orgId: org.id,
    action: 'STRIPE_CHECKOUT_STARTED',
    resourceType: 'Organization',
    resourceId: org.id,
    metadata: { tier, quantity, sessionId: session.id },
  });

  return NextResponse.json({ data: { url: session.url } }, { status: 200 });
}
