import { NextResponse } from 'next/server';
import { ExternalContextMediaKind } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { writeAuditLog } from '@/lib/audit/log';
import { externalContextExtractionQueue } from '@/lib/queue';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; ecId: string }> },
) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;
  void req;

  const { id: patientId, ecId } = await params;
  const row = await prisma.externalContext.findFirst({
    where: { id: ecId, patientId, orgId: authorizationUser.orgId },
    select: {
      id: true,
      patientId: true,
      mediaKind: true,
      status: true,
      deletedAt: true,
      documentFileKeys: true,
      patient: { select: { orgId: true } },
    },
  });
  if (!row) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(row.patient.orgId, authorizationUser.orgId);

  if (row.mediaKind !== ExternalContextMediaKind.DOCUMENT) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Only document rows can be discarded here.' } },
      { status: 400 },
    );
  }
  if (row.deletedAt) {
    return NextResponse.json({
      data: { id: row.id, deletedAt: row.deletedAt.toISOString() },
    });
  }

  const deletedAt = new Date();
  const updated = await prisma.externalContext.update({
    where: { id: row.id },
    data: {
      deletedAt,
      deletedByOrgUserId: orgUser.id,
    },
  });
  const removedJobCount = await removePendingExtractionJobs(row.id);

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'EXTERNAL_CONTEXT_DISCARDED',
    resourceType: 'ExternalContext',
    resourceId: row.id,
    metadata: {
      patientId: row.patientId,
      status: row.status,
      documentCount: row.documentFileKeys.length,
      discardedByOrgUserId: orgUser.id,
      removedJobCount,
    },
  });

  return NextResponse.json({
    data: { id: updated.id, deletedAt: updated.deletedAt?.toISOString() ?? deletedAt.toISOString() },
  });
}

async function removePendingExtractionJobs(externalContextId: string): Promise<number> {
  const jobs = await externalContextExtractionQueue.getJobs(['waiting', 'delayed', 'paused'], 0, 1000, false);
  let removed = 0;
  for (const job of jobs) {
    const data = job.data as { externalContextId?: string };
    if (data.externalContextId !== externalContextId) continue;
    await job.remove();
    removed += 1;
  }
  return removed;
}
