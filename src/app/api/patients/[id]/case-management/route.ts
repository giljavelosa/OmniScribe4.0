import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

/** GET /api/patients/[id]/case-management — list cases for chart + visit picker. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('VISITS_CREATE', req);
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const { id: patientId } = await params;

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, orgId: authorizationUser.orgId, isDeleted: false },
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
    include: {
      episodes: {
        where: { status: { in: ['ACTIVE', 'RECERT_DUE', 'DISCHARGED'] } },
        select: {
          id: true,
          diagnosis: true,
          bodyPart: true,
          primaryIcd: true,
          primaryIcdLabel: true,
          secondaryIcd: true,
          secondaryIcdLabel: true,
          status: true,
          recertDueAt: true,
          recertIntervalDays: true,
          visitsAuthorized: true,
          visitsCompleted: true,
        },
      },
      encounters: {
        orderBy: { startedAt: 'desc' },
        take: 1,
        select: { startedAt: true },
      },
    },
  });

  return NextResponse.json({
    data: cases.map((c) => ({
      id: c.id,
      primaryIcd: c.primaryIcd,
      primaryIcdLabel: c.primaryIcdLabel,
      secondaryIcd: c.secondaryIcd,
      secondaryIcdLabel: c.secondaryIcdLabel,
      description: c.description,
      status: c.status,
      openedAt: c.openedAt.toISOString(),
      lastActivityAt:
        c.encounters[0]?.startedAt?.toISOString() ?? c.openedAt.toISOString(),
      episodes: c.episodes.map((ep) => ({
        ...ep,
        recertDueAt: ep.recertDueAt?.toISOString() ?? null,
      })),
    })),
  });
}
