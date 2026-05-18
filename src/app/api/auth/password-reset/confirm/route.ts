import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

import { prisma } from '@/lib/prisma';
import { validatePassword } from '@/lib/auth/password-policy';

export const runtime = 'nodejs';

const bodySchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(1),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const { token, newPassword } = parsed.data;

  const policy = validatePassword(newPassword);
  if (!policy.ok) {
    return NextResponse.json(
      { error: { code: 'weak_password', message: policy.reason } },
      { status: 400 },
    );
  }

  const candidates = await prisma.passwordResetToken.findMany({
    where: { consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  let matched: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    if (await bcrypt.compare(token, c.tokenHash)) {
      matched = c;
      break;
    }
  }
  if (!matched) {
    return NextResponse.json({ error: { code: 'gone' } }, { status: 410 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: matched.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: matched.id },
      data: { consumedAt: new Date() },
    }),
    // Invalidate all UserSessions for this user — they must sign in fresh.
    prisma.userSession.deleteMany({ where: { userId: matched.userId } }),
    prisma.auditLog.create({
      data: { userId: matched.userId, action: 'PASSWORD_RESET_COMPLETED' },
    }),
  ]);

  return NextResponse.json({ data: { ok: true } });
}
