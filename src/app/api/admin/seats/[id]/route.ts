import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

/**
 * DELETE /api/admin/seats/[id] — revokes a single seat row.
 *
 * Unassigns the seat from any OrgUser first (FK guarantees seat.assignedTo
 * is single-occupancy via the @unique constraint). Audits SEAT_REVOKED.
 * Does NOT update Stripe in v1 — the spec calls for a follow-up
 * subscription-recount endpoint, but for v1 the seat count is consulted
 * lazily on the next allocation. Logged as a Unit 09 architecture decision.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id } = await params;
  const seat = await prisma.seat.findUnique({
    where: { id },
    include: { assignedTo: { include: { user: { select: { id: true, email: true } } } } },
  });
  if (!seat) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(seat.orgId, authorizationUser.orgId);

  await prisma.$transaction(async (tx) => {
    if (seat.assignedTo) {
      await tx.orgUser.update({
        where: { id: seat.assignedTo.id },
        data: { seatId: null },
      });
    }
    await tx.seat.delete({ where: { id } });
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'SEAT_REVOKED',
    resourceType: 'Seat',
    resourceId: id,
    metadata: {
      tier: seat.tier,
      wasAssigned: !!seat.assignedTo,
      assignedToOrgUserId: seat.assignedTo?.id ?? null,
    },
  });

  return NextResponse.json({ data: { ok: true } });
}
