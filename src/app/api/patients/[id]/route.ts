import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { isValidPersonName } from '@/lib/patient/name-validator';
import { PatientSex } from '@prisma/client';
import { buildSnapshotStrip } from '@/lib/snapshots/build-snapshot-strip';
import { deriveAssessmentSnippet } from '@/lib/notes/note-text';
import type { FinalJsonShape } from '@/lib/notes/build-artifact-prompt';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    firstName: z
      .string()
      .min(1)
      .refine(isValidPersonName, { message: 'invalid characters in first name' })
      .optional(),
    lastName: z
      .string()
      .min(1)
      .refine(isValidPersonName, { message: 'invalid characters in last name' })
      .optional(),
    mrn: z.string().min(1).optional(),
    dob: z.string().optional(),
    sex: z.enum(PatientSex).optional(),
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

  // Unit 12: compute snapshot strip + recent visits with assessment snippets.
  const [snapshotStrip, recentVisits] = await Promise.all([
    buildSnapshotStrip({ orgId: authorizationUser.orgId, patientId: patient.id }),
    prisma.note.findMany({
      where: {
        patientId: patient.id,
        orgId: authorizationUser.orgId,
        status: { in: ['SIGNED', 'TRANSFERRED'] },
      },
      orderBy: { signedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        signedAt: true,
        signedByUserId: true,
        division: true,
        finalJson: true,
        template: { select: { name: true } },
      },
    }),
  ]);

  const visitHistory = recentVisits.map((n) => ({
    id: n.id,
    signedAt: n.signedAt?.toISOString() ?? null,
    signedByUserId: n.signedByUserId,
    division: n.division,
    templateName: n.template?.name ?? null,
    assessmentSnippet: deriveAssessmentSnippet(
      (n.finalJson as unknown as FinalJsonShape) ?? null,
    ),
  }));

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'PATIENT_VIEWED',
    resourceType: 'Patient',
    resourceId: patient.id,
  });

  return NextResponse.json({
    data: {
      ...patient,
      snapshotStrip,
      visitHistory,
    },
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT', req);
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

  // Unit 12: if any demographics field actually moved, emit the dedicated
  // PATIENT_DEMOGRAPHICS_EDITED row. Higher-severity than the generic
  // PATIENT_UPDATED — surfaces cleanly in compliance dashboards that
  // filter for demographic changes (e.g., HIPAA breach-trail audits).
  const DEMOGRAPHIC_FIELDS = new Set([
    'firstName',
    'lastName',
    'mrn',
    'dob',
    'sex',
    'phone',
    'email',
    'preferredLanguage',
  ]);
  const demographicsChanged = changed.filter((f) => DEMOGRAPHIC_FIELDS.has(f));
  if (demographicsChanged.length > 0) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'PATIENT_DEMOGRAPHICS_EDITED',
      resourceType: 'Patient',
      resourceId: id,
      metadata: { changedFields: demographicsChanged },
    });
  }
  return NextResponse.json({ data: { ok: true } });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  if (authorizationUser.role !== 'ORG_ADMIN') {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

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
