import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

import { prisma } from '@/lib/prisma';
import { validatePassword } from '@/lib/auth/password-policy';
import { divisionForProfession } from '@/lib/professions';
import { PlatformRole } from '@prisma/client';

export const runtime = 'nodejs';

const bodySchema = z.object({
  password: z.string().min(1),
});

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const { password } = parsed.data;

  const policy = validatePassword(password);
  if (!policy.ok) {
    return NextResponse.json({ error: { code: 'weak_password', message: policy.reason } }, { status: 400 });
  }

  // Re-verify invite is unconsumed and unexpired AT REQUEST TIME (don't trust
  // DB constraints alone; expired/consumed paths must return 410 Gone).
  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite || invite.consumedAt || invite.expiresAt < new Date()) {
    return NextResponse.json({ error: { code: 'gone' } }, { status: 410 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Heal-on-accept: derive the OrgUser division from the invited profession so the
  // materialized membership is always consistent (a PT invite becomes REHAB even
  // if a stored invite.division predates the derive-from-profession rule). VIEWER
  // invites carry no profession → fall back to the admin-picked invite.division.
  const division = divisionForProfession(invite.professionType) ?? invite.division;

  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email: invite.email } });
    const u = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: { passwordHash, platformRole: existing.platformRole ?? PlatformRole.NONE },
        })
      : await tx.user.create({
          data: { email: invite.email, passwordHash, platformRole: PlatformRole.NONE },
        });

    await tx.orgUser.upsert({
      where: { userId_orgId: { userId: u.id, orgId: invite.orgId } },
      update: {
        role: invite.role,
        division,
        professionType: invite.professionType,
        profession: invite.profession,
        canManagePatients: invite.canManagePatients,
        isActive: true,
      },
      create: {
        userId: u.id,
        orgId: invite.orgId,
        role: invite.role,
        division,
        professionType: invite.professionType,
        profession: invite.profession,
        canManagePatients: invite.canManagePatients,
        isActive: true,
      },
    });

    await tx.invite.update({
      where: { id: invite.id },
      data: { consumedAt: new Date(), consumedByUserId: u.id },
    });

    await tx.auditLog.create({
      data: {
        userId: u.id,
        orgId: invite.orgId,
        action: 'INVITE_CONSUMED',
        resourceType: 'Invite',
        resourceId: invite.id,
        metadata: { existing_user: Boolean(existing) },
      },
    });
    if (!existing) {
      await tx.auditLog.create({
        data: {
          userId: u.id,
          orgId: invite.orgId,
          action: 'USER_CREATED',
          metadata: { via: 'onboarding' },
        },
      });
    }

    return u;
  });

  return NextResponse.json({ data: { userId: user.id, email: user.email } });
}
