import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { PatientDepartmentEnrollmentStatus } from '@prisma/client';

export const runtime = 'nodejs';

const bodySchema = z.object({
  departmentId: z.string().min(1),
  status: z.enum(PatientDepartmentEnrollmentStatus).default(PatientDepartmentEnrollmentStatus.ACTIVE),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const { id } = await params;
  const patient = await prisma.patient.findFirst({
    where: { id, orgId: authorizationUser.orgId, isDeleted: false },
  });
  if (!patient) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  // Ensure the department also belongs to the same org (cross-org enrollment is a leak).
  const dept = await prisma.department.findFirst({
    where: { id: parsed.data.departmentId, orgId: authorizationUser.orgId },
  });
  if (!dept) return NextResponse.json({ error: { code: 'department_not_found' } }, { status: 404 });

  const enrollment = await prisma.patientDepartmentEnrollment.create({
    data: {
      patientId: id,
      orgId: authorizationUser.orgId,
      departmentId: dept.id,
      status: parsed.data.status,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'PATIENT_ENROLLMENT_CHANGED',
    resourceType: 'PatientDepartmentEnrollment',
    resourceId: enrollment.id,
    metadata: { op: 'create', departmentId: dept.id, status: parsed.data.status },
  });

  return NextResponse.json({ data: { id: enrollment.id } });
}
