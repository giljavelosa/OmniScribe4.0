import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { DeletedRecordType, PlatformRole } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { writePlatformAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const deleteSchema = z.object({
  confirmEmail: z.email(),
});

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user: actor } = guard;

  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'User email confirmation is required.' } },
      { status: 400 },
    );
  }

  const { id } = await params;
  if (id === actor.id) {
    return NextResponse.json(
      { error: { code: 'cannot_delete_self', message: 'You cannot delete your own platform-owner account.' } },
      { status: 409 },
    );
  }

  const target = await prisma.user.findFirst({
    where: { id, isDeleted: false },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      passwordHash: true,
      signingPinHash: true,
      platformRole: true,
      orgUsers: { select: { id: true, orgId: true, isActive: true } },
    },
  });
  if (!target) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  if (parsed.data.confirmEmail.toLowerCase() !== target.email.toLowerCase()) {
    return NextResponse.json(
      { error: { code: 'confirmation_mismatch', message: 'User email did not match.' } },
      { status: 400 },
    );
  }
  if (target.platformRole === PlatformRole.PLATFORM_OWNER) {
    return NextResponse.json(
      { error: { code: 'owner_account_protected', message: 'Remove platform-owner role before deleting this user.' } },
      { status: 409 },
    );
  }

  const deletedAt = new Date();
  const orgUserIds = target.orgUsers.map((orgUser) => orgUser.id);
  // Only memberships active at delete time get reversed on restore — never
  // resurrect a membership the org had already deactivated.
  const activeOrgUserIds = target.orgUsers
    .filter((orgUser) => orgUser.isActive)
    .map((orgUser) => orgUser.id);
  const deletedPasswordHash = await bcrypt.hash(randomBytes(32).toString('base64url'), 12);
  const anonymizedEmail = `deleted-${target.id}@deleted.local`;

  await prisma.$transaction(async (tx) => {
    // Owner-only recovery ledger — stash the original identity BEFORE we
    // anonymize the live row so a platform-owner restore can reconstitute it.
    await tx.deletedRecordLedger.create({
      data: {
        recordType: DeletedRecordType.USER,
        recordId: target.id,
        originalEmail: target.email,
        originalName: target.name,
        originalImage: target.image,
        originalPasswordHash: target.passwordHash,
        originalSigningPinHash: target.signingPinHash,
        originalPlatformRole: target.platformRole,
        deactivatedOrgUserIds: activeOrgUserIds,
        deletedAt,
        deletedByUserId: actor.id,
      },
    });

    if (orgUserIds.length > 0) {
      await tx.copilotMessage.deleteMany({
        where: { conversation: { clinicianOrgUserId: { in: orgUserIds } } },
      });
      await tx.copilotConversation.deleteMany({
        where: { clinicianOrgUserId: { in: orgUserIds } },
      });
      await tx.copilotPatientState.deleteMany({
        where: { clinicianOrgUserId: { in: orgUserIds } },
      });
      await tx.cleoNudge.deleteMany({
        where: { clinicianOrgUserId: { in: orgUserIds } },
      });
      await tx.fhirIdentity.deleteMany({
        where: { clinicianOrgUserId: { in: orgUserIds } },
      });
      await tx.practitionerProfile.deleteMany({
        where: { orgUserId: { in: orgUserIds } },
      });
      await tx.voiceProfile.updateMany({
        where: { orgUserId: { in: orgUserIds }, isDeleted: false },
        data: {
          isDeleted: true,
          deletedAt,
          hardDeleteAt: new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      await tx.orgUserSite.deleteMany({
        where: {
          OR: [
            { orgUserId: { in: orgUserIds } },
            { enrolledByOrgUserId: { in: orgUserIds } },
          ],
        },
      });
      await tx.orgUser.updateMany({
        where: { id: { in: orgUserIds } },
        data: { isActive: false, seatId: null },
      });
    }

    await tx.passwordResetToken.deleteMany({ where: { userId: target.id } });
    await tx.userSession.deleteMany({ where: { userId: target.id } });
    await tx.platformSession.deleteMany({ where: { userId: target.id } });
    await tx.user.update({
      where: { id: target.id },
      data: {
        email: anonymizedEmail,
        name: null,
        image: null,
        passwordHash: deletedPasswordHash,
        signingPinHash: null,
        signUnlockedUntil: null,
        platformRole: PlatformRole.NONE,
        failedLoginCount: 0,
        lockedUntil: null,
        isDeleted: true,
        deletedAt,
        deletedByUserId: actor.id,
      },
    });
    await writePlatformAuditLog({
      actingUserId: actor.id ?? 'unknown',
      action: 'PLATFORM_USER_DELETED',
      resourceType: 'User',
      resourceId: target.id,
      metadata: {
        softDelete: true,
        anonymized: true,
        orgMembershipCount: target.orgUsers.length,
        hadPlatformRole: target.platformRole,
      },
      tx,
    });
  });

  return NextResponse.json({ data: { ok: true, userId: target.id } });
}
