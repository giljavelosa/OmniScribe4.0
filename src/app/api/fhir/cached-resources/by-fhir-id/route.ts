import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  ehrSystem: z.string().min(1).max(40),
  resourceType: z.string().min(1).max(40),
  fhirResourceId: z.string().min(1).max(120),
});

/**
 * GET /api/fhir/cached-resources/by-fhir-id
 *   ?ehrSystem=…&resourceType=…&fhirResourceId=…
 *
 * Lookup-by-natural-key for the BriefCard's EhrSourcePill drawer.
 * The brief carries the EHR-side identifiers; this endpoint resolves
 * them to the cached row (which carries both raw + simplified shapes).
 *
 * NOTE_REVIEW-gated; the row's patient.orgId asserts org scoping.
 * Writes FHIR_RESOURCE_VIEWED audit on every successful resolve so
 * the auditor lens can see who inspected which resource and when.
 */
export async function GET(req: Request) {
  const guard = await requireFeatureAccess('NOTE_REVIEW');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    ehrSystem: url.searchParams.get('ehrSystem') ?? undefined,
    resourceType: url.searchParams.get('resourceType') ?? undefined,
    fhirResourceId: url.searchParams.get('fhirResourceId') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const row = await prisma.fhirCachedResource.findUnique({
    where: {
      ehrSystem_resourceType_fhirResourceId: {
        ehrSystem: parsed.data.ehrSystem,
        resourceType: parsed.data.resourceType,
        fhirResourceId: parsed.data.fhirResourceId,
      },
    },
    include: { patient: { select: { orgId: true } } },
  });
  if (!row) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(row.patient.orgId, authorizationUser.orgId);

  const wrapped = row.resource as { raw?: unknown; simplified?: unknown };

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'FHIR_RESOURCE_VIEWED',
    resourceType: 'FhirCachedResource',
    resourceId: row.id,
    metadata: {
      ehrSystem: row.ehrSystem,
      resourceType: row.resourceType,
      fhirResourceId: row.fhirResourceId,
    },
  });

  return NextResponse.json({
    data: {
      id: row.id,
      ehrSystem: row.ehrSystem,
      resourceType: row.resourceType,
      fhirResourceId: row.fhirResourceId,
      fetchedAt: row.fetchedAt.toISOString(),
      sensitivityLevel: row.sensitivityLevel,
      raw: wrapped.raw ?? null,
      simplified: wrapped.simplified ?? null,
    },
  });
}
