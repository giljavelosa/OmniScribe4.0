import { NextResponse } from 'next/server';
import { DeletedRecordType } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { writePlatformAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

/**
 * POST /api/owner/orgs/[id]/restore — platform-owner restore of a
 * soft-deleted organization. Reverses the operational soft-delete:
 * un-hides the org and reactivates exactly the memberships + seats the
 * delete switched off (recorded in the recovery ledger). Seat *assignments*
 * are not auto-restored — an org admin reassigns seats after restore.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user: actor } = guard;

  const { id } = await params;
  const org = await prisma.organization.findFirst({
    where: { id, isDeleted: true },
    select: { id: true, name: true },
  });
  if (!org) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const ledger = await prisma.deletedRecordLedger.findFirst({
    where: { recordType: DeletedRecordType.ORGANIZATION, recordId: id, restoredAt: null },
    orderBy: { deletedAt: 'desc' },
  });

  const restoredAt = new Date();
  const orgUserIds = ledger?.deactivatedOrgUserIds ?? [];
  const seatIds = ledger?.deactivatedSeatIds ?? [];

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id },
      data: { isDeleted: false, deletedAt: null, deletedByUserId: null },
    });
    if (seatIds.length > 0) {
      await tx.seat.updateMany({ where: { id: { in: seatIds } }, data: { isActive: true } });
    }
    if (orgUserIds.length > 0) {
      // Only reactivate memberships whose user isn't itself soft-deleted.
      await tx.orgUser.updateMany({
        where: { id: { in: orgUserIds }, user: { isDeleted: false } },
        data: { isActive: true },
      });
    }
    if (ledger) {
      await tx.deletedRecordLedger.update({
        where: { id: ledger.id },
        data: { restoredAt, restoredByUserId: actor.id },
      });
    }
    await writePlatformAuditLog({
      actingUserId: actor.id ?? 'unknown',
      action: 'PLATFORM_ORG_RESTORED',
      resourceType: 'Organization',
      resourceId: id,
      metadata: {
        reactivatedOrgUserCount: orgUserIds.length,
        reactivatedSeatCount: seatIds.length,
        hadLedger: Boolean(ledger),
      },
      tx,
    });
  });

  return NextResponse.json({ data: { ok: true, orgId: id } });
}
