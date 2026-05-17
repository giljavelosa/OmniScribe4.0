import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { startVisit } from '@/lib/encounters/start';

export const runtime = 'nodejs';

/**
 * Transition a SCHEDULED schedule to IN_PROGRESS, create the Encounter, mint
 * the Note (status PREPARING), and return the noteId so the client can route
 * to /prepare/[noteId]. Note.division is locked at this moment per spec §E.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('VISITS_CREATE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id } = await params;
  const schedule = await prisma.schedule.findFirst({
    where: { id, orgId: authorizationUser.orgId },
    include: { encounter: true },
  });
  if (!schedule) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  // Idempotent: if encounter already exists for this schedule, return its note.
  if (schedule.encounter) {
    const existingNote = await prisma.note.findFirst({
      where: { encounterId: schedule.encounter.id },
      orderBy: { createdAt: 'asc' },
    });
    if (existingNote) {
      return NextResponse.json({ data: { noteId: existingNote.id, encounterId: schedule.encounter.id } });
    }
  }

  const { encounter, note } = await prisma.$transaction(async (tx) =>
    startVisit({
      tx,
      orgId: schedule.orgId,
      patientId: schedule.patientId,
      clinicianOrgUserId: schedule.clinicianOrgUserId,
      siteId: schedule.siteId,
      roomId: schedule.roomId,
      scheduleId: schedule.id,
      actingUserId: user.id,
    }),
  );

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'SCHEDULE_STARTED',
    resourceType: 'Schedule',
    resourceId: schedule.id,
    metadata: { encounterId: encounter.id, noteId: note.id },
  });

  return NextResponse.json({ data: { noteId: note.id, encounterId: encounter.id } });
}
