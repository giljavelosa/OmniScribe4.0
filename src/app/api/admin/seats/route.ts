import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SeatTier } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { upsertSubscription, stripeConfig } from '@/services/billing/stripe';

export const runtime = 'nodejs';

const createSchema = z.object({
  tier: z.enum(SeatTier),
  count: z.number().int().min(1).max(500),
  /** ISO date. Seats expire on the org's renewal date by default. */
  expiresAt: z.string().min(1),
});

/**
 * GET / POST /api/admin/seats — list + allocate seats for the current org.
 *
 * POST atomic semantics: the seat-row creation + Stripe upsertSubscription
 * run inside `prisma.$transaction`. If Stripe throws, the transaction
 * rolls back so no orphan Seat rows survive. In stub mode (no
 * STRIPE_SECRET_KEY) the call never throws so the transaction always
 * commits — `STRIPE_SUBSCRIPTION_STUB` audit row captures the stubbed
 * subscription id for trail completeness.
 */
export async function GET() {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const seats = await prisma.seat.findMany({
    where: { orgId: authorizationUser.orgId },
    orderBy: { createdAt: 'desc' },
    include: { assignedTo: { include: { user: { select: { email: true } } } } },
  });

  return NextResponse.json({
    data: seats.map((s) => ({
      id: s.id,
      tier: s.tier,
      expiresAt: s.expiresAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      assignedToOrgUserId: s.assignedTo?.id ?? null,
      assignedToEmail: s.assignedTo?.user?.email ?? null,
    })),
    summary: {
      totalSeats: seats.length,
      assignedSeats: seats.filter((s) => !!s.assignedTo).length,
      byTier: countByTier(seats),
    },
    stripeStubMode: stripeConfig.isStubMode,
  });
}

export async function POST(req: Request) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const expiresAt = new Date(parsed.data.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Invalid expiresAt.' } },
      { status: 400 },
    );
  }

  let result: {
    createdIds: string[];
    subscription: Awaited<ReturnType<typeof upsertSubscription>>;
    newTotal: number;
  };
  try {
    result = await prisma.$transaction(async (tx) => {
      // Read the count INSIDE the tx so concurrent allocations don't both see
      // the pre-state and each report an incorrect newTotal upstream.
      const existingCount = await tx.seat.count({
        where: { orgId: authorizationUser.orgId, tier: parsed.data.tier },
      });
      const newTotal = existingCount + parsed.data.count;
      const created = await Promise.all(
        Array.from({ length: parsed.data.count }, () =>
          tx.seat.create({
            data: {
              orgId: authorizationUser.orgId,
              tier: parsed.data.tier,
              expiresAt,
            },
          }),
        ),
      );
      const subscription = await upsertSubscription({
        orgId: authorizationUser.orgId,
        seatCount: newTotal,
        tier: parsed.data.tier,
        expiresAt,
      });
      return { createdIds: created.map((s) => s.id), subscription, newTotal };
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'stripe_failed',
          message:
            err instanceof Error ? err.message.slice(0, 200) : 'Subscription upsert failed.',
        },
      },
      { status: 502 },
    );
  }

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'SEAT_ALLOCATED',
    resourceType: 'Seat',
    resourceId: result.createdIds.join(','),
    metadata: {
      tier: parsed.data.tier,
      countAllocated: parsed.data.count,
      newTotalForTier: result.newTotal,
      expiresAt: expiresAt.toISOString(),
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: result.subscription.stub ? 'STRIPE_SUBSCRIPTION_STUB' : 'STRIPE_SUBSCRIPTION_UPDATED',
    resourceType: 'Organization',
    resourceId: authorizationUser.orgId,
    metadata: {
      subscriptionId: result.subscription.subscriptionId,
      status: result.subscription.status,
      seatCount: result.newTotal,
      tier: parsed.data.tier,
      stub: result.subscription.stub,
    },
  });

  return NextResponse.json(
    {
      data: {
        createdSeatIds: result.createdIds,
        subscription: result.subscription,
      },
    },
    { status: 201 },
  );
}

function countByTier(seats: { tier: SeatTier }[]): Record<string, number> {
  const out: Record<string, number> = { SOLO: 0, TEAM: 0, ENTERPRISE: 0 };
  for (const s of seats) {
    out[s.tier] = (out[s.tier] ?? 0) + 1;
  }
  return out;
}
