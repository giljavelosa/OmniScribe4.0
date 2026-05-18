import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { adaptResource, extractSensitivityLevel, FHIR_RESOURCE_TYPES, type FhirResourceType } from '@/services/fhir/adapters';
import { fetchResourceBundle, type FetcherIdentity } from '@/services/fhir/resource-fetcher';

/**
 * Sync orchestrator — Unit 21 (Wave 4 / F3).
 *
 * Pulls each resource type for a verified patient link, simplifies via
 * the adapter dispatch, upserts into `FhirCachedResource`. Per-type
 * failure isolation: one type's failure doesn't poison the others.
 * Returns a structured summary the API can hand to the UI.
 */

export type SyncOpts = {
  patientId: string;
  ehrSystem: string;
  triggerUserId: string;
  triggerOrgUserId: string;
  orgId: string;
};

export type SyncResult = {
  ok: boolean;
  fhirPatientId: string;
  totalFetched: number;
  totalCached: number;
  perResourceType: Record<FhirResourceType, { count: number; error: string | null }>;
};

/** Public entry — resolves identities, runs the per-type loop, audits. */
export async function syncPatientResources(opts: SyncOpts): Promise<SyncResult> {
  const verifiedLink = await prisma.patientFhirIdentity.findFirst({
    where: {
      patientId: opts.patientId,
      ehrSystem: opts.ehrSystem,
      matchConfidence: 'verified',
    },
  });
  if (!verifiedLink) {
    throw new SyncPreconditionError('not_linked', 'No verified EHR link for this patient.');
  }

  const fhirIdentity = await prisma.fhirIdentity.findUnique({
    where: {
      clinicianOrgUserId_ehrSystem: {
        clinicianOrgUserId: opts.triggerOrgUserId,
        ehrSystem: opts.ehrSystem,
      },
    },
  });
  if (!fhirIdentity) {
    throw new SyncPreconditionError(
      'ehr_not_connected',
      'You need to connect to the EHR before syncing patient data.',
    );
  }

  await writeAuditLog({
    userId: opts.triggerUserId,
    orgId: opts.orgId,
    action: 'FHIR_SYNC_TRIGGERED',
    resourceType: 'PatientFhirIdentity',
    resourceId: verifiedLink.id,
    metadata: { ehrSystem: opts.ehrSystem, fhirPatientId: verifiedLink.fhirPatientId },
  });

  const identitySnapshot: FetcherIdentity = {
    id: fhirIdentity.id,
    fhirBaseUrl: fhirIdentity.fhirBaseUrl,
    ehrSystem: fhirIdentity.ehrSystem,
    accessTokenEnc: fhirIdentity.accessTokenEnc,
    refreshTokenEnc: fhirIdentity.refreshTokenEnc,
    expiresAt: fhirIdentity.expiresAt,
    scope: fhirIdentity.scope,
  };

  const perResourceType: SyncResult['perResourceType'] = Object.fromEntries(
    FHIR_RESOURCE_TYPES.map((t) => [t, { count: 0, error: null }]),
  ) as SyncResult['perResourceType'];
  let totalFetched = 0;
  let totalCached = 0;
  let allOk = true;

  for (const resourceType of FHIR_RESOURCE_TYPES) {
    try {
      const result = await fetchAndCacheResourceType({
        identity: identitySnapshot,
        resourceType,
        fhirPatientId: verifiedLink.fhirPatientId,
        patientId: opts.patientId,
        ehrSystem: opts.ehrSystem,
      });
      perResourceType[resourceType] = { count: result.cached, error: null };
      totalFetched += result.fetched;
      totalCached += result.cached;
      if (result.cached > 0) {
        await writeAuditLog({
          userId: opts.triggerUserId,
          orgId: opts.orgId,
          action: 'FHIR_RESOURCE_CACHED',
          resourceType: 'FhirCachedResource',
          resourceId: `${opts.ehrSystem}:${resourceType}:${verifiedLink.fhirPatientId}`,
          metadata: { ehrSystem: opts.ehrSystem, resourceType, count: result.cached },
        });
      }
    } catch (err) {
      allOk = false;
      const message = err instanceof Error ? err.message.slice(0, 200) : String(err);
      perResourceType[resourceType] = { count: 0, error: message };
    }
  }

  const summary: SyncResult = {
    ok: allOk,
    fhirPatientId: verifiedLink.fhirPatientId,
    totalFetched,
    totalCached,
    perResourceType,
  };

  await writeAuditLog({
    userId: opts.triggerUserId,
    orgId: opts.orgId,
    action: 'FHIR_SYNC_COMPLETED',
    resourceType: 'PatientFhirIdentity',
    resourceId: verifiedLink.id,
    metadata: {
      ehrSystem: opts.ehrSystem,
      fhirPatientId: verifiedLink.fhirPatientId,
      totalFetched,
      totalCached,
      perResourceType,
    },
  });

  return summary;
}

async function fetchAndCacheResourceType(args: {
  identity: FetcherIdentity;
  resourceType: FhirResourceType;
  fhirPatientId: string;
  patientId: string;
  ehrSystem: string;
}): Promise<{ fetched: number; cached: number }> {
  const bundle = await fetchResourceBundle({
    identity: args.identity,
    resourceType: args.resourceType,
    fhirPatientId: args.fhirPatientId,
  });
  const entries = bundle.entry ?? [];
  let cached = 0;
  for (const entry of entries) {
    const resource = entry.resource;
    if (!resource?.id || resource.resourceType !== args.resourceType) continue;
    const simplified = adaptResource(resource);
    if (!simplified) continue;
    await prisma.fhirCachedResource.upsert({
      where: {
        ehrSystem_resourceType_fhirResourceId: {
          ehrSystem: args.ehrSystem,
          resourceType: args.resourceType,
          fhirResourceId: resource.id,
        },
      },
      update: {
        resource: { raw: resource, simplified } as Prisma.InputJsonValue,
        fetchedAt: new Date(),
        sensitivityLevel: extractSensitivityLevel(resource),
      },
      create: {
        patientId: args.patientId,
        ehrSystem: args.ehrSystem,
        resourceType: args.resourceType,
        fhirResourceId: resource.id,
        resource: { raw: resource, simplified } as Prisma.InputJsonValue,
        sensitivityLevel: extractSensitivityLevel(resource),
      },
    });
    cached += 1;
  }
  return { fetched: entries.length, cached };
}

export class SyncPreconditionError extends Error {
  constructor(public readonly code: 'not_linked' | 'ehr_not_connected', message: string) {
    super(message);
    this.name = 'SyncPreconditionError';
  }
}
