import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

const bodySchema = z.object({
  patientId: z.string().min(1),
});

/**
 * POST /api/case-management/check-dups — existing cases for de-dup UI (Phase 1).
 * FHIR conditions return empty until Phase 2.
 */
export async function POST(req: Request) {
  const guard = await requireFeatureAccess('VISITS_CREATE', req);
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const patient = await prisma.patient.findFirst({
    where: {
      id: parsed.data.patientId,
      orgId: authorizationUser.orgId,
      isDeleted: false,
    },
    select: { id: true, orgId: true },
  });
  if (!patient) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(patient.orgId, authorizationUser.orgId);

  const cases = await prisma.caseManagement.findMany({
    where: {
      patientId: patient.id,
      orgId: authorizationUser.orgId,
      status: { in: ['ACTIVE', 'CLOSED'] },
    },
    orderBy: { openedAt: 'desc' },
    select: {
      id: true,
      primaryIcd: true,
      primaryIcdLabel: true,
      secondaryIcd: true,
      status: true,
      openedAt: true,
      encounters: {
        orderBy: { startedAt: 'desc' },
        take: 1,
        select: { startedAt: true },
      },
    },
  });

  return NextResponse.json({
    data: {
      existingCases: cases.map((c) => ({
        id: c.id,
        primaryIcd: c.primaryIcd,
        primaryIcdLabel: c.primaryIcdLabel,
        secondaryIcd: c.secondaryIcd,
        status: c.status,
        lastActivityAt:
          c.encounters[0]?.startedAt?.toISOString() ?? c.openedAt.toISOString(),
      })),
      fhirConditions: [],
    },
  });
}
