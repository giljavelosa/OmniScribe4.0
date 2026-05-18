import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

const patchSchema = z.object({
  matchConfidence: z.literal('verified'),
});

const deleteSchema = z.object({
  reason: z.string().min(1).max(200).optional(),
});

/**
 * PATCH /api/patients/[id]/fhir-identities/[fid] — promote a 'high' or
 * 'manual' link to 'verified' (clinician confirmation of an auto-match).
 * F2's manual flow creates at 'verified' directly; this endpoint exists
 * so the future auto-match polish (and F3 stale-link refresh) can share
 * the verification path.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; fid: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id: patientId, fid } = await params;
  const link = await prisma.patientFhirIdentity.findFirst({
    where: { id: fid, patientId },
    include: { patient: { select: { orgId: true } } },
  });
  if (!link) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(link.patient.orgId, authorizationUser.orgId);

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  if (link.matchConfidence === 'verified') {
    return NextResponse.json({ data: { id: link.id, alreadyVerified: true } });
  }

  await prisma.patientFhirIdentity.update({
    where: { id: fid },
    data: {
      matchConfidence: 'verified',
      verifiedAt: new Date(),
      verifiedByOrgUserId: authorizationUser.orgUserId,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'FHIR_PATIENT_LINK_VERIFIED',
    resourceType: 'PatientFhirIdentity',
    resourceId: fid,
    metadata: {
      ehrSystem: link.ehrSystem,
      fhirPatientId: link.fhirPatientId,
      previousConfidence: link.matchConfidence,
    },
  });

  return NextResponse.json({ data: { id: link.id } });
}

/**
 * DELETE /api/patients/[id]/fhir-identities/[fid] — unlink. Hard-deletes
 * the row (the audit row is the history). Reason in the request body is
 * optional but captured in audit metadata when present.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; fid: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id: patientId, fid } = await params;
  const link = await prisma.patientFhirIdentity.findFirst({
    where: { id: fid, patientId },
    include: { patient: { select: { orgId: true } } },
  });
  if (!link) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(link.patient.orgId, authorizationUser.orgId);

  const parsed = deleteSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  await prisma.patientFhirIdentity.delete({ where: { id: fid } });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'FHIR_PATIENT_LINK_REMOVED',
    resourceType: 'PatientFhirIdentity',
    resourceId: fid,
    metadata: {
      ehrSystem: link.ehrSystem,
      fhirPatientId: link.fhirPatientId,
      reason: parsed.data.reason ?? 'clinician_initiated',
    },
  });

  return NextResponse.json({ data: { ok: true } });
}
