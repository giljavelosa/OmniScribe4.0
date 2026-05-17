import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { destroyRoom } from '@/services/telehealth/daily';

export const runtime = 'nodejs';

const bodySchema = z.object({
  reason: z.string().max(280).optional(),
});

/**
 * POST /api/admin/telehealth/sessions/[id]/end — clinician ends the call.
 * Destroys the Daily.co room (stub-mode safe), flips status to COMPLETED,
 * sets endedAt + endedReason. Refuses 409 on already-COMPLETED.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('VISITS_CREATE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id } = await params;
  const session = await prisma.telehealthSession.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(session.orgId, authorizationUser.orgId);

  if (session.status === 'COMPLETED') {
    return NextResponse.json(
      { error: { code: 'already_completed' } },
      { status: 409 },
    );
  }

  // Destroy the Daily.co room if one was provisioned. Best-effort —
  // a destroy failure doesn't block the status flip.
  if (session.roomName) {
    try {
      await destroyRoom({ roomName: session.roomName });
      await writeAuditLog({
        userId: user.id,
        orgId: authorizationUser.orgId,
        action: 'TELEHEALTH_ROOM_DESTROYED',
        resourceType: 'TelehealthSession',
        resourceId: id,
        metadata: { roomName: session.roomName },
      });
    } catch (e) {
      console.warn('[telehealth/sessions/end] destroyRoom failed:', e);
    }
  }

  const updated = await prisma.telehealthSession.update({
    where: { id },
    data: {
      status: 'COMPLETED',
      endedAt: new Date(),
      endedReason: parsed.data.reason ?? null,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'TELEHEALTH_SESSION_ENDED',
    resourceType: 'TelehealthSession',
    resourceId: id,
    metadata: {
      scheduleId: session.scheduleId,
      patientId: session.patientId,
      hasReason: !!parsed.data.reason,
      previousStatus: session.status,
    },
  });

  return NextResponse.json({ data: updated });
}
