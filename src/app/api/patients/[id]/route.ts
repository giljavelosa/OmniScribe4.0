import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { Division, PatientSex } from '@prisma/client';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    mrn: z.string().min(1).optional(),
    dob: z.string().optional(),
    sex: z.enum(PatientSex).optional(),
    division: z.enum(Division).optional(),
    siteId: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
    preferredLanguage: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no_fields' });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id } = await params;
  const patient = await prisma.patient.findFirst({
    where: { id, orgId: authorizationUser.orgId, isDeleted: false },
    include: {
      addresses: true,
      coverages: true,
      emergencyContacts: true,
      consents: true,
      communicationPreferences: true,
      episodes: {
        where: { status: { in: ['ACTIVE', 'RECERT_DUE'] } },
        include: { department: true, goals: true },
      },
    },
  });
  if (!patient) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(patient.orgId, authorizationUser.orgId);

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'PATIENT_VIEWED',
    resourceType: 'Patient',
    resourceId: patient.id,
  });

  return NextResponse.json({ data: patient });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const data = parsed.data;

  const { id } = await params;
  const before = await prisma.patient.findFirst({
    where: { id, orgId: authorizationUser.orgId, isDeleted: false },
  });
  if (!before) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(before.orgId, authorizationUser.orgId);

  let dob: Date | undefined;
  if (data.dob) {
    dob = new Date(data.dob);
    if (Number.isNaN(dob.getTime())) {
      return NextResponse.json({ error: { code: 'bad_request', message: 'Invalid DOB.' } }, { status: 400 });
    }
  }

  const changed: string[] = [];
  for (const key of Object.keys(data)) {
    const incoming = (data as Record<string, unknown>)[key];
    const existing = (before as unknown as Record<string, unknown>)[key];
    // dob is a string in the request payload and a Date on the model — compare
    // by timestamp so the audit log reflects real changes only.
    if (key === 'dob') {
      const existingMs = existing instanceof Date ? existing.getTime() : null;
      const incomingMs = dob ? dob.getTime() : null;
      if (existingMs !== incomingMs) changed.push(key);
      continue;
    }
    if (incoming !== existing) {
      changed.push(key);
    }
  }

  await prisma.patient.update({
    where: { id },
    data: {
      ...(data.firstName !== undefined && { firstName: data.firstName }),
      ...(data.lastName !== undefined && { lastName: data.lastName }),
      ...(data.mrn !== undefined && { mrn: data.mrn }),
      ...(dob && { dob }),
      ...(data.sex !== undefined && { sex: data.sex }),
      ...(data.division !== undefined && { division: data.division }),
      ...(data.siteId !== undefined && { siteId: data.siteId }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.preferredLanguage !== undefined && { preferredLanguage: data.preferredLanguage }),
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'PATIENT_UPDATED',
    resourceType: 'Patient',
    resourceId: id,
    // PHI-free: log changed FIELD NAMES, never the values.
    metadata: { changedFields: changed },
  });

  return NextResponse.json({ data: { ok: true } });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id } = await params;
  const patient = await prisma.patient.findFirst({
    where: { id, orgId: authorizationUser.orgId, isDeleted: false },
  });
  if (!patient) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(patient.orgId, authorizationUser.orgId);

  await prisma.patient.update({
    where: { id },
    data: { isDeleted: true, deletedAt: new Date() },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'PATIENT_DELETED',
    resourceType: 'Patient',
    resourceId: id,
    metadata: { softDelete: true },
  });

  return NextResponse.json({ data: { ok: true } });
}
