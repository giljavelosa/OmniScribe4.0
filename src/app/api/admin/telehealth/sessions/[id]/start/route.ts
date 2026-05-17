import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { createRoom, dailyConfig } from '@/services/telehealth/daily';

export const runtime = 'nodejs';

/**
 * POST /api/admin/telehealth/sessions/[id]/start — clinician starts the
 * call. Creates Daily.co room (stub-mode safe), flips status to ACTIVE,
 * sets startedAt. Refuses 409 if the patient hasn't verified or consented
 * yet (CONSENT_CAPTURED is the prerequisite state).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('VISITS_CREATE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id } = await params;
  const session = await prisma.telehealthSession.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(session.orgId, authorizationUser.orgId);

  if (session.status === 'ACTIVE') {
    return NextResponse.json(
      { error: { code: 'already_active' } },
      { status: 409 },
    );
  }
  if (session.status !== 'CONSENT_CAPTURED' && session.status !== 'VERIFIED') {
    return NextResponse.json(
      {
        error: {
          code: 'not_ready',
          message: `Session must be VERIFIED or CONSENT_CAPTURED before start (current: ${session.status}).`,
        },
      },
      { status: 409 },
    );
  }

  // Create the Daily.co room (stub-mode safe).
  const room = await createRoom({
    sessionId: session.id,
    expiresAt: session.magicExpiresAt,
  });

  const updated = await prisma.telehealthSession.update({
    where: { id },
    data: {
      status: 'ACTIVE',
      startedAt: new Date(),
      roomName: room.roomName,
      roomUrl: room.roomUrl,
      roomExpiresAt: room.expiresAt,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'TELEHEALTH_ROOM_CREATED',
    resourceType: 'TelehealthSession',
    resourceId: id,
    metadata: {
      roomName: room.roomName,
      stub: room.stub,
      dailyStubMode: dailyConfig.isStubMode,
    },
  });
  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'TELEHEALTH_SESSION_STARTED',
    resourceType: 'TelehealthSession',
    resourceId: id,
    metadata: {
      scheduleId: session.scheduleId,
      patientId: session.patientId,
      previousStatus: session.status,
    },
  });

  return NextResponse.json({ data: updated });
}
