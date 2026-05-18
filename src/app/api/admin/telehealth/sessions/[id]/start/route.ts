import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { createRoom, dailyConfig } from '@/services/telehealth/daily';
import { startVisit } from '@/lib/encounters/start';

export const runtime = 'nodejs';

/**
 * POST /api/admin/telehealth/sessions/[id]/start — clinician starts the
 * call.
 *
 * Wave 3 contract: CONSENT_CAPTURED is the prerequisite — no audio path
 * opens until the patient has acknowledged consent. Unit 15's variant
 * allowed VERIFIED for permissiveness; Unit 16 tightens it now that the
 * consent step actually exists in the patient flow.
 *
 * Two side-effects on first successful call:
 *   1. Daily.co room created (stub-mode safe — synthetic URL when
 *      DAILY_API_KEY unset).
 *   2. Encounter + Note minted via the shared startVisit() helper — same
 *      one /api/schedules/[id]/start uses — and `session.noteId` is set
 *      so Unit 17's room surface can resolve session → noteId in one hop
 *      and reuse /api/notes/[id]/realtime-key for the Soniox handshake.
 *
 * Idempotent: a second POST after success returns the existing
 * noteId + roomUrl unchanged, no duplicate audit rows.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('VISITS_CREATE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id } = await params;
  const session = await prisma.telehealthSession.findUnique({
    where: { id },
    include: { schedule: true },
  });
  if (!session) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(session.orgId, authorizationUser.orgId);

  // Idempotent success: already started + Note in place → return what we have.
  if (session.status === 'ACTIVE' && session.noteId && session.roomUrl) {
    return NextResponse.json({
      data: {
        id: session.id,
        status: session.status,
        roomUrl: session.roomUrl,
        roomName: session.roomName,
        noteId: session.noteId,
      },
    });
  }

  if (session.status !== 'CONSENT_CAPTURED') {
    // CONSENT_CAPTURED is the only acceptable prerequisite — the state
    // machine is SCHEDULED → VERIFIED → CONSENT_CAPTURED → ACTIVE, and
    // VERIFIED alone means the patient hasn't consented yet (HIPAA gate).
    return NextResponse.json(
      {
        error: {
          code: 'not_ready',
          message: `Session must be CONSENT_CAPTURED before start (current: ${session.status}).`,
        },
      },
      { status: 409 },
    );
  }

  // Create the Daily.co room first — external call. If the downstream
  // Note-creation transaction fails, the room expires on its own
  // (expiresAt is set); the alternative ordering risks orphan Notes,
  // which are more painful to clean up.
  const room = await createRoom({
    sessionId: session.id,
    expiresAt: session.magicExpiresAt,
  });

  const { noteId, encounterId } = await prisma.$transaction(async (tx) => {
    const { encounter, note } = await startVisit({
      tx,
      orgId: session.orgId,
      patientId: session.patientId,
      clinicianOrgUserId: session.schedule.clinicianOrgUserId,
      siteId: session.schedule.siteId,
      roomId: session.schedule.roomId,
      scheduleId: session.scheduleId,
      actingUserId: user.id,
    });
    await tx.telehealthSession.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        startedAt: new Date(),
        roomName: room.roomName,
        roomUrl: room.roomUrl,
        roomExpiresAt: room.expiresAt,
        noteId: note.id,
      },
    });
    return { noteId: note.id, encounterId: encounter.id };
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
      noteId,
      encounterId,
    },
  });

  return NextResponse.json({
    data: {
      id,
      status: 'ACTIVE' as const,
      roomUrl: room.roomUrl,
      roomName: room.roomName,
      noteId,
    },
  });
}
