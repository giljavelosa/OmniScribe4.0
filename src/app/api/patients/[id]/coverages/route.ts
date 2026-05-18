import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { PatientCoverageStatus } from '@prisma/client';

export const runtime = 'nodejs';

const bodySchema = z.object({
  carrier: z.string().min(1),
  planName: z.string().optional(),
  memberId: z.string().min(1),
  groupId: z.string().optional(),
  status: z.enum(PatientCoverageStatus).default(PatientCoverageStatus.ACTIVE),
  effectiveDate: z.string().optional(),
  terminationDate: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const data = parsed.data;

  const { id } = await params;
  const patient = await prisma.patient.findFirst({
    where: { id, orgId: authorizationUser.orgId, isDeleted: false },
  });
  if (!patient) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const coverage = await prisma.patientCoverage.create({
    data: {
      patientId: id,
      carrier: data.carrier,
      planName: data.planName,
      memberId: data.memberId,
      groupId: data.groupId,
      status: data.status,
      effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
      terminationDate: data.terminationDate ? new Date(data.terminationDate) : null,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'PATIENT_COVERAGE_UPSERT',
    resourceType: 'PatientCoverage',
    resourceId: coverage.id,
    metadata: { op: 'create', status: data.status },
  });

  return NextResponse.json({ data: { id: coverage.id } });
}
