import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { findMeasureDef } from '@/lib/snapshots/registry';

export const runtime = 'nodejs';

const bodySchema = z.object({
  measureKey: z.string().min(1).max(120),
  /** Scalar (number), string ("3+"), or structured object (BP {systolic, diastolic}).
   *  Trusting the client here is intentional — the renderer coerces to display
   *  shape; storage is opaque Json. PHI denylist still applies via audit log. */
  valueJson: z.unknown(),
  unit: z.string().max(40).nullable().optional(),
  episodeId: z.string().nullable().optional(),
  /** ISO. Optional — defaults to enteredAt. */
  recordedAt: z.string().min(1).optional(),
});

/**
 * POST /api/patients/[id]/snapshot/override
 *
 * Atomic create + auto-supersede: any non-superseded override for the same
 * (patientId, measureKey, scope) gets supersededAt=now in the same
 * transaction, then the new row inserts. Latest non-superseded row per
 * (measureKey, scope) wins on read.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  if (!findMeasureDef(parsed.data.measureKey)) {
    return NextResponse.json(
      { error: { code: 'unknown_measure', message: `measureKey "${parsed.data.measureKey}" not in registry.` } },
      { status: 400 },
    );
  }

  const { id: patientId } = await params;
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, orgId: authorizationUser.orgId, isDeleted: false },
    select: { id: true, orgId: true },
  });
  if (!patient) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(patient.orgId, authorizationUser.orgId);

  // Validate episodeId if supplied + scope to org.
  let episodeId: string | null = null;
  if (parsed.data.episodeId) {
    const ep = await prisma.episodeOfCare.findFirst({
      where: { id: parsed.data.episodeId, orgId: authorizationUser.orgId, patientId },
      select: { id: true },
    });
    if (!ep) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'episodeId not found or not on this patient.' } },
        { status: 400 },
      );
    }
    episodeId = ep.id;
  }

  const recordedAt = parsed.data.recordedAt ? new Date(parsed.data.recordedAt) : new Date();
  if (Number.isNaN(recordedAt.getTime())) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Invalid recordedAt.' } },
      { status: 400 },
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const supersededCount = await tx.snapshotOverride.updateMany({
      where: {
        patientId,
        orgId: authorizationUser.orgId,
        measureKey: parsed.data.measureKey,
        episodeId: episodeId,
        supersededAt: null,
      },
      data: {
        supersededAt: new Date(),
        supersededByOrgUserId: authorizationUser.orgUserId,
      },
    });
    const created = await tx.snapshotOverride.create({
      data: {
        orgId: authorizationUser.orgId,
        patientId,
        episodeId,
        measureKey: parsed.data.measureKey,
        valueJson: parsed.data.valueJson as never,
        unit: parsed.data.unit ?? null,
        recordedAt,
        enteredByOrgUserId: authorizationUser.orgUserId,
      },
    });
    return { created, supersededCount: supersededCount.count };
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'SNAPSHOT_OVERRIDE_CREATED',
    resourceType: 'SnapshotOverride',
    resourceId: result.created.id,
    metadata: {
      patientId,
      episodeId,
      measureKey: parsed.data.measureKey,
      supersededPriorCount: result.supersededCount,
    },
  });
  if (result.supersededCount > 0) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'SNAPSHOT_OVERRIDE_SUPERSEDED',
      resourceType: 'SnapshotOverride',
      resourceId: result.created.id,
      metadata: {
        patientId,
        episodeId,
        measureKey: parsed.data.measureKey,
        supersededCount: result.supersededCount,
        reason: 'replaced_by_new_override',
      },
    });
  }

  return NextResponse.json({ data: result.created }, { status: 201 });
}
