import type Stripe from 'stripe';
import type { SeatTier } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/**
 * reconcileSeats — the single source of truth for turning a Stripe
 * subscription's state into `Seat` rows.
 *
 * Called by the Stripe webhook on checkout completion + subscription
 * create/update. Idempotent: it diffs the subscription's seat `quantity`
 * against the ACTIVE seats tagged with this subscription id and converges
 * them — creating, reactivating, or deactivating as needed.
 *
 * Assigned seats are never deactivated by a downgrade (only unassigned
 * ones), so a clinician never silently loses their seat to a billing
 * change. Returns null when the subscription carries no `orgId` metadata —
 * the checkout route always stamps it, so a subscription without it cannot
 * be mapped to an org and is skipped.
 */

type Tier = Extract<SeatTier, 'SOLO' | 'TEAM'>;

function resolveTier(sub: Stripe.Subscription): Tier {
  const metaTier = sub.metadata?.tier;
  if (metaTier === 'SOLO' || metaTier === 'TEAM') return metaTier;
  const priceId = sub.items.data[0]?.price?.id;
  if (priceId && priceId === process.env.STRIPE_SOLO_PRICE_ID) return 'SOLO';
  return 'TEAM';
}

function resolveExpiry(sub: Stripe.Subscription): Date {
  // `current_period_end` lived on the Subscription in older Stripe API
  // versions and moved onto the SubscriptionItem in newer ones — read both
  // shapes. Falls back to ~one billing month out if neither is present.
  const item = sub.items.data[0];
  const periodEnd =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    (item as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  if (periodEnd) return new Date(periodEnd * 1000);
  return new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
}

export type ReconcileResult = {
  orgId: string;
  active: boolean;
  created: number;
  reactivated: number;
  deactivated: number;
};

export async function reconcileSeats(
  sub: Stripe.Subscription,
): Promise<ReconcileResult | null> {
  const orgId = sub.metadata?.orgId;
  if (!orgId) return null;

  const tier = resolveTier(sub);
  const quantity = sub.items.data[0]?.quantity ?? 1;
  const expiresAt = resolveExpiry(sub);
  const shouldBeActive = sub.status === 'active' || sub.status === 'trialing';

  // The customer-id link is always safe to (re)write.
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    },
  });

  const existing = await prisma.seat.findMany({
    where: { orgId, stripeSubId: sub.id },
    orderBy: { createdAt: 'asc' },
    include: { assignedTo: { select: { id: true } } },
  });

  // Subscription not active (past_due / canceled / unpaid / paused) —
  // deactivate every seat it paid for; create nothing.
  if (!shouldBeActive) {
    const r = await prisma.seat.updateMany({
      where: { orgId, stripeSubId: sub.id, isActive: true },
      data: { isActive: false },
    });
    return { orgId, active: false, created: 0, reactivated: 0, deactivated: r.count };
  }

  const activeSeats = existing.filter((s) => s.isActive);
  const inactiveSeats = existing.filter((s) => !s.isActive);
  const diff = quantity - activeSeats.length;

  let created = 0;
  let reactivated = 0;
  let deactivated = 0;

  if (diff > 0) {
    // Reactivate previously-deactivated seats before minting new ones, so a
    // 5→3→5 quantity cycle reuses rows instead of leaking dead ones.
    const toReactivate = inactiveSeats.slice(0, diff).map((s) => s.id);
    if (toReactivate.length > 0) {
      const r = await prisma.seat.updateMany({
        where: { id: { in: toReactivate } },
        data: { isActive: true },
      });
      reactivated = r.count;
    }
    const stillNeeded = diff - toReactivate.length;
    if (stillNeeded > 0) {
      const r = await prisma.seat.createMany({
        data: Array.from({ length: stillNeeded }, () => ({
          orgId,
          tier,
          expiresAt,
          isActive: true,
          stripeSubId: sub.id,
        })),
      });
      created = r.count;
    }
  } else if (diff < 0) {
    // Downgrade — deactivate only UNASSIGNED active seats. An assigned seat
    // is never pulled out from under a clinician by a billing change; a
    // customer who downgrades below their assigned-seat count keeps paying
    // for the overage until they revoke an assignment.
    const toDeactivate = activeSeats
      .filter((s) => !s.assignedTo)
      .slice(0, -diff)
      .map((s) => s.id);
    if (toDeactivate.length > 0) {
      const r = await prisma.seat.updateMany({
        where: { id: { in: toDeactivate } },
        data: { isActive: false },
      });
      deactivated = r.count;
    }
  }

  // Keep tier + expiry fresh on every live seat for this subscription
  // (renewal pushes expiresAt out; a plan change updates tier).
  await prisma.seat.updateMany({
    where: { orgId, stripeSubId: sub.id, isActive: true },
    data: { tier, expiresAt },
  });

  return { orgId, active: true, created, reactivated, deactivated };
}
