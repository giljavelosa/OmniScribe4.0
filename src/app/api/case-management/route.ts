import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CaseManagementStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

const createSchema = z.object({
  patientId: z.string().min(1),
  primaryIcd: z.string().max(16).optional().nullable(),
  primaryIcdLabel: z.string().min(1).max(280),
  secondaryIcd: z.string().max(16).optional().nullable(),
  secondaryIcdLabel: z.string().max(280).optional().nullable(),
  description: z.string().max(120).optional().nullable(),
});

/**
 * POST /api/case-management — open a new CaseManagement for a patient.
 */
export async function POST(req: Request) {
  const guard = await requireFeatureAccess('VISITS_CREATE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const data = parsed.data;

  const patient = await prisma.patient.findFirst({
    where: { id: data.patientId, orgId: authorizationUser.orgId, isDeleted: false },
    select: { id: true, orgId: true },
  });
  if (!patient) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(patient.orgId, authorizationUser.orgId);

  const created = await prisma.caseManagement.create({
    data: {
      orgId: authorizationUser.orgId,
      patientId: patient.id,
      primaryIcd: data.primaryIcd ?? null,
      primaryIcdLabel: data.primaryIcdLabel.trim(),
      secondaryIcd: data.secondaryIcd ?? null,
      secondaryIcdLabel: data.secondaryIcdLabel?.trim() ?? null,
      description: data.description?.trim() ?? null,
      // Unit 49 — stamp at creation from the opening clinician's division.
      // Immutable thereafter (no UPDATE path exposed for division).
      division: authorizationUser.division,
      status: CaseManagementStatus.ACTIVE,
      openedByOrgUserId: authorizationUser.orgUserId,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'CASE_MANAGEMENT_CREATED',
    resourceType: 'CaseManagement',
    resourceId: created.id,
    metadata: {
      patientId: patient.id,
      hasPrimaryIcd: !!data.primaryIcd,
      hasSecondaryIcd: !!data.secondaryIcd,
    },
  });

  return NextResponse.json({
    data: {
      id: created.id,
      primaryIcd: created.primaryIcd,
      primaryIcdLabel: created.primaryIcdLabel,
      secondaryIcd: created.secondaryIcd,
      secondaryIcdLabel: created.secondaryIcdLabel,
      status: created.status,
      openedAt: created.openedAt.toISOString(),
    },
  });
}
