/**
 * Sprint 0.19 / Tier 14 — mark an internal team message as READ.
 * Idempotent: re-posting on an already-READ message is a no-op + 200.
 * Only the recipient may mark their own message read.
 */
import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;
  const { id } = await params;

  const row = await prisma.internalPatientMessage.findFirst({
    where: { id, orgId: authorizationUser.orgId, isDeleted: false },
    select: { id: true, recipientOrgUserId: true, status: true, readAt: true },
  });
  if (!row) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  if (row.recipientOrgUserId !== authorizationUser.orgUserId) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }
  if (row.status === 'READ' || row.status === 'ARCHIVED') {
    return NextResponse.json({ data: { messageId: id, status: row.status, readAt: row.readAt?.toISOString() ?? null } });
  }

  const now = new Date();
  await prisma.internalPatientMessage.update({
    where: { id },
    data: { status: 'READ', readAt: now },
  });
  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'INTERNAL_PATIENT_MESSAGE_READ',
    resourceType: 'InternalPatientMessage',
    resourceId: id,
    metadata: { messageId: id },
  });
  return NextResponse.json({ data: { messageId: id, status: 'READ', readAt: now.toISOString() } });
}
