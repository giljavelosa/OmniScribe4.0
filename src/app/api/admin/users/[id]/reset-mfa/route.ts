import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { verifyTotpToken } from '@/lib/mfa';
import { writeAuditLog } from '@/lib/audit/log';
import { sendTransactional } from '@/lib/email/transport';

export const runtime = 'nodejs';

const bodySchema = z.object({
  reason: z.string().min(10),
  adminMfaToken: z.string().regex(/^\d{6}$/),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE', req);
  if ('error' in guard) return guard.error;
  const { user, orgUser, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.path[0] === 'reason' ? 'reason_too_short' : 'bad_request';
    return NextResponse.json({ error: { code } }, { status: 400 });
  }
  const { reason, adminMfaToken } = parsed.data;

  // Re-verify admin's own MFA before any destructive change.
  const me = await prisma.user.findUnique({ where: { id: user.id } });
  if (!me?.mfaSecret) {
    return NextResponse.json({ error: { code: 'admin_mfa_not_enrolled' } }, { status: 403 });
  }
  const adminOk = await verifyTotpToken({ secret: me.mfaSecret, token: adminMfaToken });
  if (!adminOk) {
    return NextResponse.json({ error: { code: 'invalid_admin_mfa' } }, { status: 401 });
  }

  const { id: targetUserId } = await params;

  // Confirm target is in admin's org.
  const targetOrgUser = await prisma.orgUser.findFirst({
    where: { userId: targetUserId, orgId: authorizationUser.orgId },
  });
  if (!targetOrgUser) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const targetBeforeMfaEnabled = (
    await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { mfaEnabled: true },
    })
  )?.mfaEnabled ?? false;

  const [, sessionDelete] = await prisma.$transaction([
    prisma.user.update({
      where: { id: targetUserId },
      data: {
        mfaSecret: null,
        mfaEnabled: false,
        // Wipe recovery codes. `undefined` in a Prisma update is a no-op
        // (Prisma's "don't touch this field" sentinel), which silently
        // preserved the old bcrypt-hashed codes. Use `{ set: [] }` to
        // explicitly clear the array.
        mfaRecoveryCodes: { set: [] },
      },
    }),
    prisma.userSession.deleteMany({ where: { userId: targetUserId } }),
  ]);

  await writeAuditLog({
    userId: targetUserId,
    orgId: orgUser.orgId,
    actingUserId: user.id,
    action: 'MFA_RESET',
    resourceType: 'User',
    resourceId: targetUserId,
    metadata: {
      reason,
      before: { mfaEnabled: targetBeforeMfaEnabled },
      after: { mfaEnabled: false },
      sessionsInvalidated: sessionDelete.count,
    },
  });

  // Best-effort notify (don't fail the request if email is down).
  try {
    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (target?.email) {
      await sendTransactional({
        to: target.email,
        subject: 'Your OmniScribe MFA was reset',
        text:
          'An administrator reset multi-factor authentication on your account. Sign in to re-enroll your authenticator app.\n\n— OmniScribe',
        html:
          '<p>An administrator reset multi-factor authentication on your account. Sign in to re-enroll your authenticator app.</p><p>— OmniScribe</p>',
      });
    }
  } catch (e) {
    console.warn('MFA reset notify-email failed:', e);
  }

  return NextResponse.json({ data: { ok: true } });
}
