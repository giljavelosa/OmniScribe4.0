import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SeatTier } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { isStripeConfigured } from '@/lib/stripe/env';

export const runtime = 'nodejs';

/**
 * GET  /api/admin/seats — list the org's seats + the assignable-user pool.
 * POST /api/admin/seats — assign a provisioned seat to a user, or revoke one.
 *
 * Seats themselves are created by the Stripe webhook (reconcileSeats), never
 * here — this route only manages WHO holds each provisioned seat. Every
 * assign/revoke writes a SeatTransfer row for the audit trail.
 *
 * TEAM_MEMBERS_MANAGE-gated (ORG_ADMIN).
 */
export async function GET() {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const orgId = guard.authorizationUser.orgId;

  const [seats, assignable, org] = await Promise.all([
    prisma.seat.findMany({
      where: { orgId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      include: { assignedTo: { include: { user: { select: { name: true, email: true } } } } },
    }),
    // The assignable pool: active non-admin members without a seat. Org admins
    // always have full access and never consume a seat, so they are excluded.
    prisma.orgUser.findMany({
      where: { orgId, isActive: true, role: { not: 'ORG_ADMIN' }, seatId: null },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { stripeCustomerId: true },
    }),
  ]);

  const activeSeats = seats.filter((s) => s.isActive);

  return NextResponse.json({
    data: seats.map((s) => ({
      id: s.id,
      tier: s.tier,
      isActive: s.isActive,
      expiresAt: s.expiresAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      assignedToOrgUserId: s.assignedTo?.id ?? null,
      assignedToName: s.assignedTo?.user?.name ?? null,
      assignedToEmail: s.assignedTo?.user?.email ?? null,
    })),
    assignableUsers: assignable.map((u) => ({
      orgUserId: u.id,
      name: u.user.name,
      email: u.user.email,
      role: u.role,
    })),
    summary: {
      totalSeats: seats.length,
      activeSeats: activeSeats.length,
      assignedSeats: activeSeats.filter((s) => !!s.assignedTo).length,
      byTier: countByTier(activeSeats),
    },
    stripeConfigured: isStripeConfigured(),
    stripeCustomerLinked: !!org?.stripeCustomerId,
  });
}

const actionSchema = z.object({
  action: z.enum(['assign', 'revoke']),
  seatId: z.string().min(1),
  orgUserId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE', req);
  if ('error' in guard) return guard.error;
  const { user } = guard;
  const orgId = guard.authorizationUser.orgId;

  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const { action, seatId, orgUserId } = parsed.data;

  // Org-scoped lookup — a seat from another org simply isn't found.
  const seat = await prisma.seat.findFirst({
    where: { id: seatId, orgId },
    include: { assignedTo: { select: { id: true } } },
  });
  if (!seat) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  if (action === 'assign') {
    if (!orgUserId) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'orgUserId is required to assign a seat.' } },
        { status: 400 },
      );
    }
    if (!seat.isActive) {
      return NextResponse.json(
        {
          error: {
            code: 'seat_inactive',
            message: 'This seat is inactive — the subscription was downgraded or canceled.',
          },
        },
        { status: 409 },
      );
    }
    if (seat.assignedTo) {
      return NextResponse.json(
        {
          error: { code: 'seat_taken', message: 'This seat is already assigned. Revoke it first.' },
        },
        { status: 409 },
      );
    }

    const target = await prisma.orgUser.findFirst({ where: { id: orgUserId, orgId } });
    if (!target || !target.isActive) {
      return NextResponse.json({ error: { code: 'user_not_found' } }, { status: 404 });
    }
    if (target.role === 'ORG_ADMIN') {
      return NextResponse.json(
        {
          error: {
            code: 'admin_no_seat',
            message: 'Org admins always have full access and do not consume a seat.',
          },
        },
        { status: 400 },
      );
    }
    if (target.seatId) {
      return NextResponse.json(
        { error: { code: 'already_seated', message: 'This user already holds a seat.' } },
        { status: 409 },
      );
    }

    await prisma.$transaction([
      prisma.orgUser.update({ where: { id: target.id }, data: { seatId: seat.id } }),
      prisma.seatTransfer.create({
        data: {
          seatId: seat.id,
          fromOrgUserId: null,
          toOrgUserId: target.id,
          reason: 'Assigned by admin',
        },
      }),
    ]);

    await writeAuditLog({
      userId: user.id,
      orgId,
      action: 'SEAT_ASSIGNED',
      resourceType: 'Seat',
      resourceId: seat.id,
      metadata: { toOrgUserId: target.id, tier: seat.tier },
    });

    return NextResponse.json({ data: { ok: true } });
  }

  // action === 'revoke'
  if (!seat.assignedTo) {
    return NextResponse.json(
      { error: { code: 'not_assigned', message: 'This seat is not assigned to anyone.' } },
      { status: 409 },
    );
  }
  const previousHolderId = seat.assignedTo.id;
  await prisma.$transaction([
    prisma.orgUser.update({ where: { id: previousHolderId }, data: { seatId: null } }),
    prisma.seatTransfer.create({
      data: {
        seatId: seat.id,
        fromOrgUserId: previousHolderId,
        toOrgUserId: null,
        reason: 'Revoked by admin',
      },
    }),
  ]);

  await writeAuditLog({
    userId: user.id,
    orgId,
    action: 'SEAT_REVOKED',
    resourceType: 'Seat',
    resourceId: seat.id,
    metadata: { fromOrgUserId: previousHolderId, tier: seat.tier },
  });

  return NextResponse.json({ data: { ok: true } });
}

function countByTier(seats: { tier: SeatTier }[]): Record<string, number> {
  const out: Record<string, number> = { SOLO: 0, TEAM: 0, ENTERPRISE: 0 };
  for (const s of seats) out[s.tier] = (out[s.tier] ?? 0) + 1;
  return out;
}
