import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { PatientDepartmentEnrollmentStatus } from '@prisma/client';

export const runtime = 'nodejs';

const bodySchema = z.object({
  status: z.enum(PatientDepartmentEnrollmentStatus),
  endedAt: z.string().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; enrollmentId: string }> },
) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const { id: patientId, enrollmentId } = await params;
  const enrollment = await prisma.patientDepartmentEnrollment.findFirst({
    where: { id: enrollmentId, patientId, orgId: authorizationUser.orgId },
  });
  if (!enrollment) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  await prisma.patientDepartmentEnrollment.update({
    where: { id: enrollmentId },
    data: {
      status: parsed.data.status,
      endedAt: parsed.data.endedAt
        ? new Date(parsed.data.endedAt)
        : enrollment.status !== parsed.data.status && parsed.data.status === 'INACTIVE'
          ? new Date()
          : enrollment.endedAt,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'PATIENT_ENROLLMENT_CHANGED',
    resourceType: 'PatientDepartmentEnrollment',
    resourceId: enrollmentId,
    metadata: { from: enrollment.status, to: parsed.data.status },
  });

  return NextResponse.json({ data: { ok: true } });
}
