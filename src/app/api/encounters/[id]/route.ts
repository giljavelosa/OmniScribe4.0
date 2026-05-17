import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id } = await params;
  const encounter = await prisma.encounter.findFirst({
    where: { id, orgId: authorizationUser.orgId },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, mrn: true, dob: true, sex: true } },
      schedule: { select: { id: true, scheduledStart: true, scheduledEnd: true, visitType: true } },
      notes: { orderBy: { createdAt: 'asc' }, select: { id: true, status: true, createdAt: true } },
    },
  });
  if (!encounter) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(encounter.orgId, authorizationUser.orgId);

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'PATIENT_VIEWED',
    resourceType: 'Encounter',
    resourceId: id,
  });

  return NextResponse.json({ data: encounter });
}
