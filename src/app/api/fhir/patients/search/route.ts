import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { searchPatients, type FhirIdentitySnapshot } from '@/services/fhir/patient-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  lastName: z.string().min(1).max(80).optional(),
  given: z.string().min(1).max(80).optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  identifier: z.string().min(1).max(80).optional(),
});

const EHR_SYSTEM = 'nextgen';

/**
 * GET /api/fhir/patients/search?lastName=…&given=…&birthDate=…&identifier=…
 *
 * Clinician-side Patient search against their connected EHR. Resolves
 * the calling clinician's FhirIdentity, forwards to patient-client.
 * Audits FHIR_PATIENT_SEARCH with field NAMES (not values — PHI fence).
 *
 * Refuses 412 (Precondition Failed) when the clinician hasn't connected
 * to an EHR yet, so the UI can route them to /admin/integrations/fhir.
 */
export async function GET(req: Request) {
  const guard = await requireFeatureAccess('NOTE_REVIEW');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    lastName: url.searchParams.get('lastName') ?? undefined,
    given: url.searchParams.get('given') ?? undefined,
    birthDate: url.searchParams.get('birthDate') ?? undefined,
    identifier: url.searchParams.get('identifier') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const { lastName, given, birthDate, identifier } = parsed.data;
  if (!lastName && !given && !birthDate && !identifier) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'at least one search field required' } },
      { status: 400 },
    );
  }

  const fhirIdentity = await prisma.fhirIdentity.findUnique({
    where: {
      clinicianOrgUserId_ehrSystem: {
        clinicianOrgUserId: authorizationUser.orgUserId,
        ehrSystem: EHR_SYSTEM,
      },
    },
  });
  if (!fhirIdentity) {
    return NextResponse.json(
      {
        error: {
          code: 'ehr_not_connected',
          message: 'Connect to NextGen first via /admin/integrations/fhir.',
        },
      },
      { status: 412 },
    );
  }

  const identitySnapshot: FhirIdentitySnapshot = {
    id: fhirIdentity.id,
    fhirBaseUrl: fhirIdentity.fhirBaseUrl,
    ehrSystem: fhirIdentity.ehrSystem,
    accessTokenEnc: fhirIdentity.accessTokenEnc,
    refreshTokenEnc: fhirIdentity.refreshTokenEnc,
    expiresAt: fhirIdentity.expiresAt,
    scope: fhirIdentity.scope,
  };

  const candidates = await searchPatients({
    identity: identitySnapshot,
    lastName,
    given,
    birthDate,
    identifier,
  });

  // PHI fence: metadata carries field NAMES, never the values.
  const fields: string[] = [];
  if (lastName) fields.push('lastName');
  if (given) fields.push('given');
  if (birthDate) fields.push('birthDate');
  if (identifier) fields.push('identifier');

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'FHIR_PATIENT_SEARCH',
    resourceType: 'FhirIdentity',
    resourceId: fhirIdentity.id,
    metadata: {
      ehrSystem: EHR_SYSTEM,
      fields,
      resultCount: candidates.length,
    },
  });

  return NextResponse.json({ data: { candidates } });
}
