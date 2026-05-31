import { NextResponse } from 'next/server';
import { DeletedRecordType, PlatformRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { writePlatformAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

/**
 * POST /api/owner/users/[id]/restore — platform-owner restore of a
 * soft-deleted (anonymized) user. Reconstitutes the original identity from
 * the owner-only recovery ledger and reactivates exactly the memberships the
 * delete switched off. Seats are NOT auto-reassigned. A user can never be
 * restored straight into PLATFORM_OWNER.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user: actor } = guard;

  const { id } = await params;
  const target = await prisma.user.findFirst({
    where: { id, isDeleted: true },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const ledger = await prisma.deletedRecordLedger.findFirst({
    where: { recordType: DeletedRecordType.USER, recordId: id, restoredAt: null },
    orderBy: { deletedAt: 'desc' },
  });
  if (!ledger || !ledger.originalEmail) {
    return NextResponse.json(
      {
        error: {
          code: 'no_recovery_ledger',
          message: 'No recovery record for this user — identity cannot be reconstituted.',
        },
      },
      { status: 409 },
    );
  }

  // The original email must be free — another account may have claimed it
  // during the deletion window. The DB unique constraint would otherwise 500.
  const collision = await prisma.user.findFirst({
    where: { email: ledger.originalEmail, id: { not: id } },
    select: { id: true },
  });
  if (collision) {
    return NextResponse.json(
      {
        error: {
          code: 'email_in_use',
          message: 'The original email is now used by another account.',
        },
      },
      { status: 409 },
    );
  }

  // Defensive: a soft-deleted user is never PLATFORM_OWNER (delete protects
  // owners), but never restore straight into owner regardless.
  const restoredRole =
    ledger.originalPlatformRole && ledger.originalPlatformRole !== PlatformRole.PLATFORM_OWNER
      ? ledger.originalPlatformRole
      : PlatformRole.NONE;

  const restoredAt = new Date();
  const orgUserIds = ledger.deactivatedOrgUserIds;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        email: ledger.originalEmail!,
        name: ledger.originalName,
        image: ledger.originalImage,
        ...(ledger.originalPasswordHash ? { passwordHash: ledger.originalPasswordHash } : {}),
        signingPinHash: ledger.originalSigningPinHash,
        platformRole: restoredRole,
        isDeleted: false,
        deletedAt: null,
        deletedByUserId: null,
      },
    });
    if (orgUserIds.length > 0) {
      // Reactivate memberships only where the org isn't itself soft-deleted.
      await tx.orgUser.updateMany({
        where: { id: { in: orgUserIds }, organization: { isDeleted: false } },
        data: { isActive: true },
      });
    }
    await tx.deletedRecordLedger.update({
      where: { id: ledger.id },
      data: { restoredAt, restoredByUserId: actor.id },
    });
    await writePlatformAuditLog({
      actingUserId: actor.id ?? 'unknown',
      action: 'PLATFORM_USER_RESTORED',
      resourceType: 'User',
      resourceId: id,
      metadata: {
        reactivatedOrgUserCount: orgUserIds.length,
        restoredPlatformRole: restoredRole,
      },
      tx,
    });
  });

  return NextResponse.json({ data: { ok: true, userId: id } });
}
