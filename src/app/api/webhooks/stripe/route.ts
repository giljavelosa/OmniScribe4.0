import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { getStripe } from '@/lib/stripe/client';
import { reconcileSeats } from '@/lib/stripe/reconcile';
import {
  fulfillMonthlyTierInvoice,
  handleCheckoutSessionCompleted,
} from '@/lib/billing/stripe-fulfillment';

export const runtime = 'nodejs';

/**
 * POST /api/webhooks/stripe — the Stripe event sink.
 *
 * Unauthenticated by design: trust comes from verifying the `stripe-signature`
 * header against STRIPE_WEBHOOK_SECRET, not from a session. This is the ONLY
 * path that materializes Seat rows — checkout itself creates nothing.
 *
 * Events handled:
 *   checkout.session.completed     → reconcile the new subscription
 *   customer.subscription.created  → reconcile
 *   customer.subscription.updated  → reconcile (quantity / status change)
 *   customer.subscription.deleted  → deactivate all of the sub's seats
 *   invoice.payment_failed         → audit only (no destructive action)
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: { code: 'stripe_not_configured' } }, { status: 501 });
  }
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: { code: 'missing_signature' } }, { status: 400 });
  }

  // Raw body — required for signature verification; never JSON-parse first.
  const rawBody = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return NextResponse.json({ error: { code: 'invalid_signature' } }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutSessionCompleted(session);

        if (typeof session.subscription === 'string') {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          // Legacy seat subscription — skip when capacity tier owns the sub.
          if (sub.metadata?.purchaseType !== 'monthly_tier') {
            await provisionFromSubscription(sub);
          }
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        if (sub.metadata?.purchaseType !== 'monthly_tier') {
          await provisionFromSubscription(sub);
        }
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const billingReason = (invoice as unknown as { billing_reason?: string }).billing_reason;
        // Initial subscription invoice is fulfilled at checkout.session.completed.
        if (billingReason === 'subscription_cycle') {
          await fulfillMonthlyTierInvoice(invoice);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const orgId = sub.metadata?.orgId;
        if (orgId) {
          const r = await prisma.seat.updateMany({
            where: { orgId, stripeSubId: sub.id, isActive: true },
            data: { isActive: false },
          });
          await writeAuditLog({
            orgId,
            action: 'STRIPE_SUBSCRIPTION_CANCELED',
            resourceType: 'Organization',
            resourceId: orgId,
            metadata: { stripeSubId: sub.id, seatsDeactivated: r.count },
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = (invoice as unknown as { subscription?: string }).subscription;
        if (typeof subId === 'string') {
          const sub = await stripe.subscriptions.retrieve(subId);
          const orgId = sub.metadata?.orgId;
          if (orgId) {
            // Audit only — no seat deactivation here. Stripe's dunning retries
            // the invoice; a terminal failure arrives later as
            // customer.subscription.updated (past_due) / .deleted, which the
            // reconcile path handles.
            await writeAuditLog({
              orgId,
              action: 'STRIPE_PAYMENT_FAILED',
              resourceType: 'Organization',
              resourceId: orgId,
              metadata: { stripeSubId: subId, invoiceId: invoice.id ?? null },
            });
          }
        }
        break;
      }
    }
  } catch (err) {
    // 500 → Stripe retries with backoff. A retry beats a swallowed
    // provisioning failure.
    console.error('[stripe-webhook] handler error:', err);
    return NextResponse.json({ error: { code: 'handler_error' } }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/**
 * Reconcile a subscription into Seat rows and audit the outcome. A null
 * result means the subscription carried no orgId metadata — nothing to do.
 */
async function provisionFromSubscription(sub: Stripe.Subscription): Promise<void> {
  const result = await reconcileSeats(sub);
  if (!result) return;
  await writeAuditLog({
    orgId: result.orgId,
    action: result.active ? 'STRIPE_SUBSCRIPTION_UPDATED' : 'STRIPE_SUBSCRIPTION_CANCELED',
    resourceType: 'Organization',
    resourceId: result.orgId,
    metadata: {
      stripeSubId: sub.id,
      status: sub.status,
      seatsCreated: result.created,
      seatsReactivated: result.reactivated,
      seatsDeactivated: result.deactivated,
    },
  });
}
