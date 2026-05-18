import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { isStale } from '@/lib/fhir/staleness';
import { FHIR_RESOURCE_TYPES } from '@/services/fhir/adapters';
import { syncPatientResources, SyncPreconditionError } from '@/services/fhir/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EHR_SYSTEM = 'nextgen';

/**
 * POST /api/patients/[id]/fhir-sync — clinician triggers a sync of all
 * 8 resource types for this patient against their verified EHR link.
 *
 * Synchronous in v1 — typical wait 2-10s in real-mode, instant in
 * stub-mode. Background BullMQ staleness sweeper is Wave 4.5 polish.
 *
 * Returns the full SyncResult so the UI can show per-type counts +
 * any partial failures.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  try {
    const result = await syncPatientResources({
      patientId,
      ehrSystem: EHR_SYSTEM,
      triggerUserId: user.id,
      triggerOrgUserId: authorizationUser.orgUserId,
      orgId: authorizationUser.orgId,
    });
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof SyncPreconditionError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: 412 },
      );
    }
    throw err;
  }
}

/**
 * GET /api/patients/[id]/fhir-sync — returns the sync status block the
 * EhrLinkPanel uses for its "Last synced X minutes ago" indicator +
 * any stale-type flags. Pure read; no audit.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW');
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const { id: patientId } = await params;
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, orgId: authorizationUser.orgId },
    select: { id: true, orgId: true },
  });
  if (!patient) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(patient.orgId, authorizationUser.orgId);

  const rows = await prisma.fhirCachedResource.findMany({
    where: { patientId, ehrSystem: EHR_SYSTEM },
    select: { resourceType: true, fetchedAt: true },
  });

  // Per-type aggregation: count + latest fetchedAt + stale flag.
  const counts: Record<string, number> = Object.fromEntries(
    FHIR_RESOURCE_TYPES.map((t) => [t, 0]),
  );
  const latestPerType = new Map<string, Date>();
  const now = new Date();
  for (const row of rows) {
    counts[row.resourceType] = (counts[row.resourceType] ?? 0) + 1;
    const prev = latestPerType.get(row.resourceType);
    if (!prev || row.fetchedAt > prev) latestPerType.set(row.resourceType, row.fetchedAt);
  }
  const staleResourceTypes = FHIR_RESOURCE_TYPES.filter((t) => {
    const latest = latestPerType.get(t);
    return latest != null && isStale(latest, now);
  });
  const lastSyncedAt = rows.length
    ? rows.reduce<Date>(
        (acc, r) => (r.fetchedAt > acc ? r.fetchedAt : acc),
        new Date(0),
      )
    : null;

  return NextResponse.json({
    data: {
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
      counts,
      staleResourceTypes,
    },
  });
}
