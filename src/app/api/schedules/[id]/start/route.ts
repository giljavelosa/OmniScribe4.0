import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

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
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('VISITS_CREATE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id } = await params;
  const schedule = await prisma.schedule.findFirst({
    where: { id, orgId: authorizationUser.orgId },
  });
  if (!schedule) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  // Run the idempotency check + visit creation in a single tx so two concurrent
  // requests cannot both pass the check and trip the Encounter.scheduleId unique
  // constraint. On constraint violation, fall back to returning the existing row.
  let result: { encounter: { id: string }; note: { id: string }; reused: boolean };
  try {
    result = await prisma.$transaction(async (tx) => {
      const existing = await tx.encounter.findUnique({
        where: { scheduleId: schedule.id },
      });
      if (existing) {
        const existingNote = await tx.note.findFirst({
          where: { encounterId: existing.id },
          orderBy: { createdAt: 'asc' },
        });
        if (existingNote) {
          return { encounter: existing, note: existingNote, reused: true };
        }
      }
      const created = await startVisit({
        tx,
        orgId: schedule.orgId,
        patientId: schedule.patientId,
        clinicianOrgUserId: schedule.clinicianOrgUserId,
        siteId: schedule.siteId,
        roomId: schedule.roomId,
        scheduleId: schedule.id,
        actingUserId: user.id,
      });
      return { ...created, reused: false };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.encounter.findUnique({ where: { scheduleId: schedule.id } });
      const existingNote = existing
        ? await prisma.note.findFirst({ where: { encounterId: existing.id }, orderBy: { createdAt: 'asc' } })
        : null;
      if (existing && existingNote) {
        return NextResponse.json({ data: { noteId: existingNote.id, encounterId: existing.id } });
      }
    }
    throw err;
  }

  if (!result.reused) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'SCHEDULE_STARTED',
      resourceType: 'Schedule',
      resourceId: schedule.id,
      metadata: { encounterId: result.encounter.id, noteId: result.note.id },
    });
  }

  return NextResponse.json({ data: { noteId: result.note.id, encounterId: result.encounter.id } });
}
