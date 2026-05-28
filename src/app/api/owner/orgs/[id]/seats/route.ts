import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SeatTier } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { writeAuditLog, writePlatformAuditLog } from '@/lib/audit/log';
import { upsertSubscription, stripeConfig } from '@/services/billing/stripe';

export const runtime = 'nodejs';

const createSchema = z.object({
  tier: z.enum(SeatTier),
  count: z.number().int().min(1).max(500),
  expiresAt: z.string().min(1),
});

/**
 * GET / POST /api/owner/orgs/[id]/seats — owner-side seat surface.
 *
 * Mirrors /api/admin/seats but takes the orgId from the URL (owner can
 * allocate for any org). Writes BOTH a per-org AuditLog row (so the
 * target org's audit shows the seat change) AND a PlatformAuditLog row
 * (owner-side trail).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;

  const { id: orgId } = await params;
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  const seats = await prisma.seat.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    include: {
      assignedTo: {
        select: { id: true, role: true, user: { select: { email: true } } },
      },
    },
  });

  return NextResponse.json({
    data: seats.map((s) => ({
      id: s.id,
      tier: s.tier,
      expiresAt: s.expiresAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      assignedToOrgUserId: s.assignedTo?.id ?? null,
      assignedToEmail: s.assignedTo?.user?.email ?? null,
      assignedToRole: s.assignedTo?.role ?? null,
    })),
    summary: {
      totalSeats: seats.length,
      assignedSeats: seats.filter((s) => !!s.assignedTo).length,
    },
    stripeStubMode: stripeConfig.isStubMode,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user: actor } = guard;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const expiresAt = new Date(parsed.data.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    return NextResponse.json({ error: { code: 'bad_request', message: 'Invalid expiresAt.' } }, { status: 400 });
  }

  const { id: orgId } = await params;
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  const existingCount = await prisma.seat.count({
    where: { orgId, tier: parsed.data.tier },
  });
  const newTotal = existingCount + parsed.data.count;

  let result: { createdIds: string[]; subscription: Awaited<ReturnType<typeof upsertSubscription>> };
  try {
    result = await prisma.$transaction(async (tx) => {
      const created = await Promise.all(
        Array.from({ length: parsed.data.count }, () =>
          tx.seat.create({
            data: { orgId, tier: parsed.data.tier, expiresAt },
          }),
        ),
      );
      const subscription = await upsertSubscription({
        orgId,
        seatCount: newTotal,
        tier: parsed.data.tier,
        expiresAt,
      });
      return { createdIds: created.map((s) => s.id), subscription };
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'stripe_failed',
          message: err instanceof Error ? err.message.slice(0, 200) : 'Subscription upsert failed.',
        },
      },
      { status: 502 },
    );
  }

  const meta = {
    tier: parsed.data.tier,
    countAllocated: parsed.data.count,
    newTotalForTier: newTotal,
    expiresAt: expiresAt.toISOString(),
    actor: 'platform-owner',
  };

  await writeAuditLog({
    userId: actor.id,
    orgId,
    action: 'SEAT_ALLOCATED',
    resourceType: 'Seat',
    resourceId: result.createdIds.join(','),
    metadata: meta,
  });
  await writePlatformAuditLog({
    actingUserId: actor.id ?? 'unknown',
    action: 'SEAT_ALLOCATED',
    resourceType: 'Seat',
    resourceId: result.createdIds.join(','),
    metadata: { ...meta, orgId },
  });

  const subAction = result.subscription.stub ? 'STRIPE_SUBSCRIPTION_STUB' : 'STRIPE_SUBSCRIPTION_UPDATED';
  await writeAuditLog({
    userId: actor.id,
    orgId,
    action: subAction,
    resourceType: 'Organization',
    resourceId: orgId,
    metadata: {
      subscriptionId: result.subscription.subscriptionId,
      status: result.subscription.status,
      seatCount: newTotal,
      tier: parsed.data.tier,
      stub: result.subscription.stub,
    },
  });
  await writePlatformAuditLog({
    actingUserId: actor.id ?? 'unknown',
    action: subAction,
    resourceType: 'Organization',
    resourceId: orgId,
    metadata: {
      subscriptionId: result.subscription.subscriptionId,
      status: result.subscription.status,
      seatCount: newTotal,
      tier: parsed.data.tier,
      stub: result.subscription.stub,
    },
  });

  return NextResponse.json(
    {
      data: { createdSeatIds: result.createdIds, subscription: result.subscription },
    },
    { status: 201 },
  );
}
