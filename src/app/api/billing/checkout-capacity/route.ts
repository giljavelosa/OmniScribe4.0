import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireFeatureAccess } from '@/lib/authz/server';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { isStripeConfigured, getPublicBaseUrl } from '@/lib/stripe/env';
import { getStripe } from '@/lib/stripe/client';
import {
  CatalogLookupError,
  getActiveCatalogPayload,
  resolveOrgMonthlyPlan,
  resolveSoloTier,
  resolveVisitBundle,
} from '@/lib/billing/catalog-resolver';

export const runtime = 'nodejs';

const bodySchema = z
  .object({
    purchaseType: z.enum([
      'monthly_tier',
      'visit_bundle',
      'org_monthly_tier',
      'collaborator_seats',
    ]),
    catalogItemId: z.string().min(1).optional(),
    seatCount: z.number().int().min(1).optional(),
    quantity: z.number().int().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.purchaseType === 'monthly_tier' || data.purchaseType === 'visit_bundle') {
      if (!data.catalogItemId) {
        ctx.addIssue({
          code: 'custom',
          message: 'catalogItemId is required for this purchase type.',
          path: ['catalogItemId'],
        });
      }
    }
    if (data.purchaseType === 'org_monthly_tier' && !data.seatCount) {
      ctx.addIssue({
        code: 'custom',
        message: 'seatCount is required for org monthly plans.',
        path: ['seatCount'],
      });
    }
    if (data.purchaseType === 'collaborator_seats' && !data.quantity) {
      ctx.addIssue({
        code: 'custom',
        message: 'quantity is required for collaborator seat add-ons.',
        path: ['quantity'],
      });
    }
  });

async function resolveStripeCustomer(org: {
  id: string;
  name: string;
  billingEmail: string;
  stripeCustomerId: string | null;
}) {
  const stripe = getStripe();
  if (org.stripeCustomerId) return org.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: org.billingEmail,
    name: org.name,
    metadata: { orgId: org.id },
  });
  await prisma.organization.update({
    where: { id: org.id },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

/**
 * POST /api/billing/checkout-capacity — Stripe Checkout for visit-bank
 * monthly tiers (solo + org), visit bundles, and collaborator seat add-ons.
 */
export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: { code: 'stripe_not_configured' } }, { status: 501 });
  }

  const guard = await requireFeatureAccess('BILLING_MANAGE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const org = await prisma.organization.findUnique({
    where: { id: authorizationUser.orgId },
    select: { id: true, name: true, billingEmail: true, stripeCustomerId: true },
  });
  if (!org) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const { purchaseType, catalogItemId, seatCount, quantity } = parsed.data;
  const stripe = getStripe();
  const customerId = await resolveStripeCustomer(org);
  const baseUrl = getPublicBaseUrl();

  try {
    if (purchaseType === 'visit_bundle') {
      const bundle = await resolveVisitBundle(catalogItemId!);
      const sharedMetadata = {
        orgId: org.id,
        purchaseType,
        catalogItemId: catalogItemId!,
        visitCredit: String(bundle.visitCount),
      };

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer: customerId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: bundle.priceCents,
              product_data: {
                name: `OmniScribe — ${bundle.label}`,
                description: `${bundle.visitCount.toLocaleString()} visits added to your org bank`,
              },
            },
          },
        ],
        metadata: sharedMetadata,
        success_url: `${baseUrl}/admin/billing?checkout=success&capacity=bundle`,
        cancel_url: `${baseUrl}/admin/billing?checkout=cancelled`,
      });

      await writeAuditLog({
        userId: user.id,
        orgId: org.id,
        action: 'STRIPE_CAPACITY_CHECKOUT_STARTED',
        resourceType: 'Organization',
        resourceId: org.id,
        metadata: {
          purchaseType,
          catalogItemId,
          visitCredit: bundle.visitCount,
          sessionId: session.id,
        },
      });

      return NextResponse.json({ data: { url: session.url } });
    }

    if (purchaseType === 'org_monthly_tier') {
      const { quote } = await resolveOrgMonthlyPlan(seatCount!);
      const sharedMetadata = {
        orgId: org.id,
        purchaseType,
        catalogItemId: 'org-monthly',
        visitCredit: String(quote.monthlyVisitCredit),
        seatCount: String(quote.seatCount),
      };

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [
          {
            quantity: quote.seatCount,
            price_data: {
              currency: 'usd',
              unit_amount: quote.seatPriceCents,
              recurring: { interval: 'month' },
              product_data: {
                name: 'OmniScribe — Team visit bank',
                description: `${quote.visitsPerSeatPerMonth} visits/seat/month · ${quote.seatCount} seats`,
              },
            },
          },
        ],
        subscription_data: { metadata: sharedMetadata },
        metadata: sharedMetadata,
        allow_promotion_codes: true,
        billing_address_collection: 'required',
        success_url: `${baseUrl}/admin/billing?checkout=success&capacity=org_tier`,
        cancel_url: `${baseUrl}/admin/billing?checkout=cancelled`,
      });

      await writeAuditLog({
        userId: user.id,
        orgId: org.id,
        action: 'STRIPE_CAPACITY_CHECKOUT_STARTED',
        resourceType: 'Organization',
        resourceId: org.id,
        metadata: {
          purchaseType,
          seatCount: quote.seatCount,
          visitCredit: quote.monthlyVisitCredit,
          sessionId: session.id,
        },
      });

      return NextResponse.json({ data: { url: session.url } });
    }

    if (purchaseType === 'collaborator_seats') {
      const { payload } = await getActiveCatalogPayload();
      const qty = quantity!;
      const sharedMetadata = {
        orgId: org.id,
        purchaseType,
        catalogItemId: 'collaborator-seat',
        visitCredit: '0',
        seatAddonQuantity: String(qty),
      };

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [
          {
            quantity: qty,
            price_data: {
              currency: 'usd',
              unit_amount: payload.collaboratorSeatPriceCents,
              recurring: { interval: 'month' },
              product_data: {
                name: 'OmniScribe — Collaborator seats',
                description: `${qty} additional clinician seat${qty === 1 ? '' : 's'}/month`,
              },
            },
          },
        ],
        subscription_data: { metadata: sharedMetadata },
        metadata: sharedMetadata,
        allow_promotion_codes: true,
        billing_address_collection: 'required',
        success_url: `${baseUrl}/admin/billing?checkout=success&capacity=collaborator`,
        cancel_url: `${baseUrl}/admin/billing?checkout=cancelled`,
      });

      await writeAuditLog({
        userId: user.id,
        orgId: org.id,
        action: 'STRIPE_CAPACITY_CHECKOUT_STARTED',
        resourceType: 'Organization',
        resourceId: org.id,
        metadata: {
          purchaseType,
          seatAddonQuantity: qty,
          sessionId: session.id,
        },
      });

      return NextResponse.json({ data: { url: session.url } });
    }

    const tier = await resolveSoloTier(catalogItemId!);
    const sharedMetadata = {
      orgId: org.id,
      purchaseType,
      catalogItemId: catalogItemId!,
      visitCredit: String(tier.monthlyVisitCredit),
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: tier.monthlyPriceCents,
            recurring: { interval: 'month' },
            product_data: {
              name: `OmniScribe — ${tier.label}`,
              description: `${tier.monthlyVisitCredit} visits credited to your bank each month`,
            },
          },
        },
      ],
      subscription_data: { metadata: sharedMetadata },
      metadata: sharedMetadata,
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      success_url: `${baseUrl}/admin/billing?checkout=success&capacity=tier`,
      cancel_url: `${baseUrl}/admin/billing?checkout=cancelled`,
    });

    await writeAuditLog({
      userId: user.id,
      orgId: org.id,
      action: 'STRIPE_CAPACITY_CHECKOUT_STARTED',
      resourceType: 'Organization',
      resourceId: org.id,
      metadata: {
        purchaseType,
        catalogItemId,
        visitCredit: tier.monthlyVisitCredit,
        sessionId: session.id,
      },
    });

    return NextResponse.json({ data: { url: session.url } });
  } catch (err) {
    if (err instanceof CatalogLookupError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: 404 },
      );
    }
    throw err;
  }
}
