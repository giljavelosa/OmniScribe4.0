import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { NoteSensitivityLevel } from '@prisma/client';

export const runtime = 'nodejs';

const bodySchema = z.object({
  sensitivityLevel: z.enum(NoteSensitivityLevel),
  reason: z.string().min(10), // sensitive transitions require a documented reason
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; intakeId: string }> },
) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const { id: patientId, intakeId } = await params;
  const intake = await prisma.patientDepartmentIntake.findFirst({
    where: { id: intakeId, patientId, patient: { orgId: authorizationUser.orgId } },
  });
  if (!intake) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  const before = intake.sensitivityLevel;
  await prisma.patientDepartmentIntake.update({
    where: { id: intakeId },
    data: { sensitivityLevel: parsed.data.sensitivityLevel },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'PATIENT_INTAKE_SENSITIVITY_CHANGED',
    resourceType: 'PatientDepartmentIntake',
    resourceId: intakeId,
    metadata: { from: before, to: parsed.data.sensitivityLevel, reason: parsed.data.reason },
  });

  return NextResponse.json({ data: { ok: true } });
}
