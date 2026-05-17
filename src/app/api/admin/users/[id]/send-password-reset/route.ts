import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { sendTransactional } from '@/lib/email/transport';
import { buildPasswordResetEmail } from '@/lib/email/templates/password-reset';

export const runtime = 'nodejs';
const TOKEN_TTL_HOURS = 1;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const { id: targetUserId } = await params;

  const targetOrgUser = await prisma.orgUser.findFirst({
    where: { userId: targetUserId, orgId: authorizationUser.orgId },
    include: { user: true },
  });
  if (!targetOrgUser) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = await bcrypt.hash(rawToken, 12);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await prisma.passwordResetToken.create({
    data: { userId: targetUserId, tokenHash, expiresAt },
  });

  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const resetUrl = `${base}/password-reset/confirm?token=${rawToken}`;
  await sendTransactional(
    buildPasswordResetEmail({ to: targetOrgUser.user.email, resetUrl, expiresInHours: TOKEN_TTL_HOURS }),
  );

  await writeAuditLog({
    userId: targetUserId,
    orgId: orgUser.orgId,
    actingUserId: user.id,
    action: 'PASSWORD_RESET_INITIATED_BY_ADMIN',
    resourceType: 'User',
    resourceId: targetUserId,
  });

  return NextResponse.json({ data: { ok: true } });
}
