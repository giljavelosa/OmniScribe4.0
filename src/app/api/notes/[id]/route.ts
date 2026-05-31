import { NextResponse } from 'next/server';
import type { NoteStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { writeAuditLog } from '@/lib/audit/log';
import { readSectionStatus, readInferenceLog } from '@/lib/notes/section-status';
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
    where: { id, orgId: authorizationUser.orgId, deletedAt: null },
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
          // isDeleted becomes undefined.
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

  // Unit 10: per-section flag — does the section have at least one
  // regeneration entry with captured previousContent? Drives the
  // "Show what changed" link in the SectionAccordion.
  const regenerations = readInferenceLog(note.inferenceLog)._regenerations ?? [];
  const sectionHasRegenHistory: Record<string, boolean> = {};
  for (const r of regenerations) {
    if (r.previousContent !== undefined) sectionHasRegenHistory[r.sectionId] = true;
  }

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
      // Late-entry charting (spec: context/specs/late-entry-charting.md).
      // dateOfService is the day care was delivered; isLateEntry flips when
      // it's at least one full day before encounter.startedAt; days gap is
      // stamped at note creation so /review and /sign can render the badge
      // without re-deriving on every request.
      dateOfService: note.dateOfService,
      isLateEntry: note.isLateEntry,
      lateEntryDaysGap: note.lateEntryDaysGap,
      template: note.template,
      patient: note.patient,
      encounter: note.encounter,
      sections,
      sectionStatus,
      sectionHasRegenHistory,
      progress,
      readyForSign,
      draftJson: note.draftJson,
      finalJson: note.finalJson,
      lastWorkerError: note.lastWorkerError,
      interruptedAt: note.interruptedAt,
    },
  });
}

/**
 * DELETE /api/notes/[id]
 *
 * Soft-deletes an unfinished recording (RECORDING/PAUSED) or an in-progress
 * draft (DRAFT/REVIEWING/PENDING_REVIEW) — the items surfaced in the Drafts
 * list. Sets deletedAt + deletedByOrgUserId; the row is NEVER hard-deleted and
 * the audio is NEVER removed from S3 (anti-regression rule 7). SIGNED /
 * TRANSFERRED notes are permanent and cannot be deleted (409). Idempotent.
 * Audited as NOTE_DELETED (rule 8 — never swallowed).
 *
 * Scope: the owning clinician or an ORG_ADMIN. VIEWER (read-only) can GET the
 * note but is explicitly forbidden from deleting it.
 */
const DELETABLE_STATUSES = new Set<NoteStatus>([
  'RECORDING',
  'PAUSED',
  'DRAFT',
  'REVIEWING',
  'PENDING_REVIEW',
]);

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const { id } = await params;
  const note = await prisma.note.findFirst({
    where: { id, orgId: authorizationUser.orgId },
    select: {
      id: true,
      orgId: true,
      status: true,
      clinicianOrgUserId: true,
      deletedAt: true,
    },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(note.orgId, authorizationUser.orgId);

  // Destructive action: only the owning clinician or an org admin. VIEWER is
  // explicitly excluded even though it has read access to the note.
  if (
    note.clinicianOrgUserId !== authorizationUser.orgUserId &&
    authorizationUser.role !== 'ORG_ADMIN'
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  // Idempotent — already discarded. Return the existing soft-delete marker.
  if (note.deletedAt) {
    return NextResponse.json({ data: { id: note.id, deletedAt: note.deletedAt.toISOString() } });
  }

  if (!DELETABLE_STATUSES.has(note.status)) {
    return NextResponse.json(
      {
        error: {
          code: 'conflict',
          message:
            'Only unfinished recordings and in-progress drafts can be deleted. Signed notes are permanent.',
        },
      },
      { status: 409 },
    );
  }

  const deletedAt = new Date();
  await prisma.note.update({
    where: { id: note.id },
    data: { deletedAt, deletedByOrgUserId: orgUser.id },
  });

  // Rule 8: audit write is NOT wrapped in swallowing try-catch — if it fails,
  // the request fails. Metadata is PHI-free (status + actor org-user id only).
  await writeAuditLog({
    userId: user.id,
    orgId: note.orgId,
    action: 'NOTE_DELETED',
    resourceType: 'Note',
    resourceId: note.id,
    metadata: { status: note.status, deletedByOrgUserId: orgUser.id },
  });

  return NextResponse.json({ data: { id: note.id, deletedAt: deletedAt.toISOString() } });
}
