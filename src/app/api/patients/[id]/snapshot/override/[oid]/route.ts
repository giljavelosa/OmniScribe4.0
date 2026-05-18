import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

/**
 * DELETE /api/patients/[id]/snapshot/override/[oid] — soft-delete.
 *
 * Sets supersededAt = now so the snapshot pipeline falls back to the
 * extracted measure (or omits the row when neither is present).
 * Idempotent: deleting an already-superseded row returns 409 already_superseded.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; oid: string }> },
) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id: patientId, oid } = await params;
  const override = await prisma.snapshotOverride.findUnique({
    where: { id: oid },
  });
  if (!override || override.patientId !== patientId) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(override.orgId, authorizationUser.orgId);

  if (override.supersededAt) {
    return NextResponse.json(
      { error: { code: 'already_superseded' } },
      { status: 409 },
    );
  }

  await prisma.snapshotOverride.update({
    where: { id: oid },
    data: {
      supersededAt: new Date(),
      supersededByOrgUserId: authorizationUser.orgUserId,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'SNAPSHOT_OVERRIDE_SUPERSEDED',
    resourceType: 'SnapshotOverride',
    resourceId: oid,
    metadata: {
      patientId,
      episodeId: override.episodeId,
      measureKey: override.measureKey,
      reason: 'clinician_revert',
    },
  });

  return NextResponse.json({ data: { ok: true } });
}
