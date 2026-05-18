import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

const bodySchema = z.object({
  ehrSystem: z.string().min(1).max(40),
  fhirPatientId: z.string().min(1).max(120),
  /** Required true — F2's only path for new links is clinician-confirmed.
   *  Auto-match flows in a future polish would POST with `confirmed: false`
   *  + matchConfidence: 'high'; for v1 we enforce confirmation here. */
  confirmed: z.literal(true),
});

/**
 * POST /api/patients/[id]/fhir-identities — clinician confirms a Patient
 * ↔ FHIR Patient link. Persists at 'verified' confidence.
 *
 * The (ehrSystem, fhirPatientId) unique index prevents the same EHR
 * patient from being linked to two different local patients; the route
 * surfaces a clean 409 instead of letting the Prisma error bubble.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id: patientId } = await params;
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, orgId: authorizationUser.orgId },
    select: { id: true, orgId: true },
  });
  if (!patient) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(patient.orgId, authorizationUser.orgId);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const { ehrSystem, fhirPatientId } = parsed.data;

  try {
    const created = await prisma.patientFhirIdentity.create({
      data: {
        patientId,
        ehrSystem,
        fhirPatientId,
        matchConfidence: 'verified',
        verifiedAt: new Date(),
        verifiedByOrgUserId: authorizationUser.orgUserId,
      },
    });
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'FHIR_PATIENT_LINK_CREATED',
      resourceType: 'PatientFhirIdentity',
      resourceId: created.id,
      metadata: {
        ehrSystem,
        fhirPatientId,
        matchConfidence: 'verified',
        source: 'manual_confirmation',
      },
    });
    return NextResponse.json({ data: { id: created.id } }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json(
        {
          error: {
            code: 'already_linked',
            message: `${ehrSystem} patient ${fhirPatientId} is already linked to a different OmniScribe patient.`,
          },
        },
        { status: 409 },
      );
    }
    throw err;
  }
}
