import { NextResponse } from 'next/server';
import { DeletedRecordType } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { writePlatformAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const deleteSchema = z.object({
  confirmName: z.string().min(1),
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
      { error: { code: 'bad_request', message: 'Organization name confirmation is required.' } },
      { status: 400 },
    );
  }

  const { id } = await params;
  const org = await prisma.organization.findFirst({
    where: { id, isDeleted: false },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          orgUsers: true,
          patients: true,
          seats: true,
          invites: true,
        },
      },
    },
  });
  if (!org) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  if (parsed.data.confirmName !== org.name) {
    return NextResponse.json(
      { error: { code: 'confirmation_mismatch', message: 'Organization name did not match.' } },
      { status: 400 },
    );
  }

  const deletedAt = new Date();

  await prisma.$transaction(async (tx) => {
    // Snapshot the rows this delete switches off so a platform-owner restore
    // reverses exactly them (and never reactivates rows that were already off).
    const [activeOrgUsers, activeSeats] = await Promise.all([
      tx.orgUser.findMany({ where: { orgId: id, isActive: true }, select: { id: true } }),
      tx.seat.findMany({ where: { orgId: id, isActive: true }, select: { id: true } }),
    ]);
    await tx.deletedRecordLedger.create({
      data: {
        recordType: DeletedRecordType.ORGANIZATION,
        recordId: id,
        deactivatedOrgUserIds: activeOrgUsers.map((orgUser) => orgUser.id),
        deactivatedSeatIds: activeSeats.map((seat) => seat.id),
        deletedAt,
        deletedByUserId: actor.id,
      },
    });
    await tx.invite.deleteMany({ where: { orgId: id } });
    await tx.seat.updateMany({
      where: { orgId: id },
      data: { isActive: false },
    });
    await tx.orgUser.updateMany({
      where: { orgId: id },
      data: { isActive: false, seatId: null },
    });
    await tx.organization.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt,
        deletedByUserId: actor.id,
      },
    });
    await writePlatformAuditLog({
      actingUserId: actor.id ?? 'unknown',
      action: 'PLATFORM_ORG_DELETED',
      resourceType: 'Organization',
      resourceId: id,
      metadata: {
        softDelete: true,
        orgUserCount: org._count.orgUsers,
        patientCount: org._count.patients,
        seatCount: org._count.seats,
        inviteCount: org._count.invites,
      },
      tx,
    });
  });

  return NextResponse.json({ data: { ok: true, orgId: id } });
}
