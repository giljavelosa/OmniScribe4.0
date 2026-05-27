import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Division, EpisodeStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

/**
 * POST /api/patients/[id]/episodes — create a new EpisodeOfCare for a patient.
 *
 * v1 fields:
 *   - diagnosis    (required)
 *   - bodyPart     (optional)
 *   - division     (required — MEDICAL / REHAB / BEHAVIORAL_HEALTH)
 *   - departmentId (required — Department must belong to the same org and
 *                   match the chosen division; the EpisodeOfCare schema makes
 *                   departmentId non-null)
 *
 * Audit: EPISODE_CREATED with division + departmentId + hasBodyPart in
 * metadata. PHI-free (diagnosis stays out of the metadata).
 */
const createSchema = z.object({
  caseManagementId: z.string().min(1),
  diagnosis: z.string().min(1).max(280),
  bodyPart: z.string().max(120).optional().nullable(),
  primaryIcd: z.string().max(16).optional().nullable(),
  primaryIcdLabel: z.string().max(280).optional().nullable(),
  secondaryIcd: z.string().max(16).optional().nullable(),
  secondaryIcdLabel: z.string().max(280).optional().nullable(),
  /** When true, episode primary/secondary swap from the parent case (rehab billing). */
  flipIcdFromCase: z.boolean().optional(),
  departmentId: z.string().min(1),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('VISITS_CREATE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id: patientId } = await params;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, orgId: authorizationUser.orgId, isDeleted: false },
    select: { id: true, orgId: true },
  });
  if (!patient) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(patient.orgId, authorizationUser.orgId);

  const department = await prisma.department.findFirst({
    where: { id: data.departmentId, orgId: authorizationUser.orgId },
    select: { id: true, orgId: true, division: true },
  });
  if (!department) {
    return NextResponse.json(
      {
        error: {
          code: 'department_not_found',
          message: 'Department not found in your organization.',
        },
      },
      { status: 400 },
    );
  }
  assertOrgScoped(department.orgId, authorizationUser.orgId);

  if (department.division !== Division.MULTI && department.division !== Division.REHAB) {
    return NextResponse.json(
      {
        error: {
          code: 'department_division_mismatch',
          message: 'Rehab episodes must use a REHAB or MULTI department.',
        },
      },
      { status: 400 },
    );
  }

  const parentCase = await prisma.caseManagement.findFirst({
    where: {
      id: data.caseManagementId,
      patientId: patient.id,
      orgId: authorizationUser.orgId,
    },
  });
  if (!parentCase) {
    return NextResponse.json(
      { error: { code: 'case_not_found', message: 'Case management not found for this patient.' } },
      { status: 400 },
    );
  }

  let primaryIcd = data.primaryIcd ?? parentCase.primaryIcd;
  let primaryIcdLabel = data.primaryIcdLabel ?? data.diagnosis;
  let secondaryIcd = data.secondaryIcd ?? parentCase.secondaryIcd;
  let secondaryIcdLabel = data.secondaryIcdLabel ?? parentCase.secondaryIcdLabel;

  if (data.flipIcdFromCase && parentCase.primaryIcd && parentCase.secondaryIcd) {
    primaryIcd = parentCase.secondaryIcd;
    primaryIcdLabel = parentCase.secondaryIcdLabel ?? primaryIcdLabel;
    secondaryIcd = parentCase.primaryIcd;
    secondaryIcdLabel = parentCase.primaryIcdLabel;
  }

  // Wrap create + backfill in one transaction so a clinician viewing
  // /patients/[id] never sees the episode exist before its encounters are
  // backfilled (and so the count we audit is consistent).
  const { created, backfilledCount, backfillSkipReason } = await prisma.$transaction(async (tx) => {
    const ep = await tx.episodeOfCare.create({
      data: {
        orgId: authorizationUser.orgId,
        patientId: patient.id,
        caseManagementId: parentCase.id,
        clinicianOrgUserId: authorizationUser.orgUserId,
        departmentId: department.id,
        division: Division.REHAB,
        diagnosis: data.diagnosis,
        bodyPart: data.bodyPart ?? null,
        primaryIcd,
        primaryIcdLabel,
        secondaryIcd,
        secondaryIcdLabel,
        status: EpisodeStatus.ACTIVE,
      },
    });

    // Backfill: link prior rehab encounters in this case that were started
    // BEFORE this episode existed (so encounters/start.ts's auto-link couldn't
    // see it) and that were never explicitly assigned to another episode.
    //
    // Guards:
    //   1. Only when this is the SOLE ACTIVE episode for the case — otherwise
    //      the assignment is ambiguous and the clinician must pick.
    //   2. Skip encounters that started during a PRIOR episode's window
    //      (encounter.startedAt < latest ENDED episode's endedAt) — those
    //      were intentionally part of that earlier episode's life.
    //   3. Encounter must have at least one REHAB note; medical/BH notes
    //      can never link to an episode (mayLinkEpisodeOnEncounter).
    const otherActive = await tx.episodeOfCare.count({
      where: {
        caseManagementId: parentCase.id,
        status: EpisodeStatus.ACTIVE,
        id: { not: ep.id },
      },
    });
    if (otherActive > 0) {
      return { created: ep, backfilledCount: 0, backfillSkipReason: 'multiple_active_episodes' as const };
    }

    // "Closed" episodes are DISCHARGED or CANCELLED. Encounters that fell
    // within a prior episode's window belong to that history; don't sweep
    // them into the new episode.
    const latestClosed = await tx.episodeOfCare.findFirst({
      where: {
        caseManagementId: parentCase.id,
        status: { in: [EpisodeStatus.DISCHARGED, EpisodeStatus.CANCELLED] },
        endedAt: { not: null },
      },
      orderBy: { endedAt: 'desc' },
      select: { endedAt: true },
    });
    const startedAfter = latestClosed?.endedAt ?? undefined;

    const { count } = await tx.encounter.updateMany({
      where: {
        caseManagementId: parentCase.id,
        episodeOfCareId: null,
        notes: { some: { division: Division.REHAB } },
        ...(startedAfter ? { startedAt: { gt: startedAfter } } : {}),
      },
      data: { episodeOfCareId: ep.id },
    });

    return { created: ep, backfilledCount: count, backfillSkipReason: null };
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'EPISODE_CREATED',
    resourceType: 'EpisodeOfCare',
    resourceId: created.id,
    metadata: {
      patientId: patient.id,
      division: created.division,
      departmentId: department.id,
      hasBodyPart: !!data.bodyPart,
      backfilledEncounterCount: backfilledCount,
      ...(backfillSkipReason ? { backfillSkipReason } : {}),
    },
  });

  return NextResponse.json({
    data: {
      id: created.id,
      diagnosis: created.diagnosis,
      bodyPart: created.bodyPart,
      division: created.division,
      status: created.status,
      departmentId: created.departmentId,
      startedAt: created.startedAt.toISOString(),
    },
  });
}
