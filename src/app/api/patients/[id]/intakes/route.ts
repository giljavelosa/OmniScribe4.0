import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { PatientDepartmentIntakeStatus, NoteSensitivityLevel } from '@prisma/client';

export const runtime = 'nodejs';

const bodySchema = z.object({
  departmentId: z.string().min(1),
  formData: z.record(z.string(), z.unknown()),
  sensitivityLevel: z.enum(NoteSensitivityLevel).optional(),
  status: z.enum(PatientDepartmentIntakeStatus).default(PatientDepartmentIntakeStatus.SUBMITTED),
});

/**
 * Validates `formData` against the department's `intakeFormSchema` (a JSON
 * Schema-ish object). For Unit 02 we do a minimal required-keys check; full
 * Ajv validation lands in a future unit when forms get richer.
 */
function validateFormData(formData: Record<string, unknown>, schema: unknown): string | null {
  if (!schema || typeof schema !== 'object') return null;
  const required = (schema as { required?: unknown }).required;
  if (Array.isArray(required)) {
    for (const k of required) {
      if (typeof k === 'string' && !(k in formData)) return `Missing required field: ${k}`;
    }
  }
  return null;
}

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

  const dept = await prisma.department.findFirst({
    where: { id: parsed.data.departmentId, orgId: authorizationUser.orgId },
  });
  if (!dept) return NextResponse.json({ error: { code: 'department_not_found' } }, { status: 404 });

  const validationError = validateFormData(parsed.data.formData, dept.intakeFormSchema);
  if (validationError) {
    return NextResponse.json({ error: { code: 'invalid_form', message: validationError } }, { status: 400 });
  }

  const intake = await prisma.patientDepartmentIntake.create({
    data: {
      patientId: id,
      departmentId: dept.id,
      status: parsed.data.status,
      sensitivityLevel: parsed.data.sensitivityLevel ?? NoteSensitivityLevel.STANDARD_CLINICAL,
      formData: parsed.data.formData as object,
      submittedAt: parsed.data.status === 'SUBMITTED' ? new Date() : null,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'PATIENT_INTAKE_SUBMITTED',
    resourceType: 'PatientDepartmentIntake',
    resourceId: intake.id,
    metadata: {
      departmentId: dept.id,
      status: parsed.data.status,
      sensitivityLevel: intake.sensitivityLevel,
    },
  });

  return NextResponse.json({ data: { id: intake.id } });
}
