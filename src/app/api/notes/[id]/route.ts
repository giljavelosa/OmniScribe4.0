import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { writeAuditLog } from '@/lib/audit/log';
import { readSectionStatus } from '@/lib/notes/section-status';
import { deriveProgressStrip, isReadyForSign } from '@/lib/notes/derive-progress-strip';
import type { NoteSectionDef } from '@/lib/notes/build-prompt';

export const runtime = 'nodejs';

/**
 * GET /api/notes/[id]
 *
 * Powers the /review surface. Returns Note + template + patient + section
 * status + readiness + draftJson. Audits PATIENT_VIEWED so reads are
 * traceable (PHI access — even by the assigned clinician — leaves a trail).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const { id } = await params;
  const note = await prisma.note.findFirst({
    where: { id, orgId: authorizationUser.orgId },
    include: {
      template: true,
      patient: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          mrn: true,
          dob: true,
          sex: true,
          preferredLanguage: true,
          // ReviewClient snapshot expects these — without them, SSE refetches
          // overwrite the initial server-render's complete patient object and
          // division/isDeleted become undefined.
          division: true,
          isDeleted: true,
        },
      },
      encounter: {
        include: {
          schedule: { select: { id: true, scheduledStart: true, scheduledEnd: true, visitType: true } },
          episode: { include: { department: true, goals: true } },
        },
      },
    },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(note.orgId, authorizationUser.orgId);

  // Clinician scope: the assigned clinician + admins can read. VIEWER role
  // can also read (per canUseFeature matrix — VIEWER has NOTE_REVIEW).
  // PHI scoping helper is canAccessClinicianOwnedResource; for Note's owner
  // we use clinicianOrgUserId.
  if (
    note.clinicianOrgUserId !== authorizationUser.orgUserId &&
    authorizationUser.role !== 'SUPER_ADMIN' &&
    authorizationUser.role !== 'ORG_ADMIN' &&
    authorizationUser.role !== 'VIEWER'
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  const sections =
    (note.template?.sectionSchema as { sections: NoteSectionDef[] } | null)?.sections ?? [];
  const sectionStatus = readSectionStatus(note.inferenceLog);
  const progress = deriveProgressStrip(sections, sectionStatus);
  const readyForSign = isReadyForSign(progress);

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'PATIENT_VIEWED',
    resourceType: 'Note',
    resourceId: note.id,
    metadata: { surface: 'review', status: note.status },
  });

  return NextResponse.json({
    data: {
      id: note.id,
      orgId: note.orgId,
      patientId: note.patientId,
      status: note.status,
      division: note.division,
      noteStyle: note.noteStyle,
      sensitivityLevel: note.sensitivityLevel,
      captureMode: note.captureMode,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      signedAt: note.signedAt,
      signedByUserId: note.signedByUserId,
      template: note.template,
      patient: note.patient,
      encounter: note.encounter,
      sections,
      sectionStatus,
      progress,
      readyForSign,
      draftJson: note.draftJson,
      finalJson: note.finalJson,
      lastWorkerError: note.lastWorkerError,
      interruptedAt: note.interruptedAt,
    },
  });
}
