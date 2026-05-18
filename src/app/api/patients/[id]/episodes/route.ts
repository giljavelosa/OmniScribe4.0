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
  diagnosis: z.string().min(1).max(280),
  bodyPart: z.string().max(120).optional().nullable(),
  division: z.enum([Division.MEDICAL, Division.REHAB, Division.BEHAVIORAL_HEALTH]),
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

  // Guardrail — a REHAB department cannot host a BH episode, etc. Multi
  // departments are allowed across divisions per spec; mirror that here.
  if (department.division !== Division.MULTI && department.division !== data.division) {
    return NextResponse.json(
      {
        error: {
          code: 'department_division_mismatch',
          message: `Department is ${department.division}; cannot host a ${data.division} episode.`,
        },
      },
      { status: 400 },
    );
  }

  const created = await prisma.episodeOfCare.create({
    data: {
      orgId: authorizationUser.orgId,
      patientId: patient.id,
      clinicianOrgUserId: authorizationUser.orgUserId,
      departmentId: department.id,
      division: data.division,
      diagnosis: data.diagnosis,
      bodyPart: data.bodyPart ?? null,
      status: EpisodeStatus.ACTIVE,
    },
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
