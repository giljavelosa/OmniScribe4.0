import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { verifyTotpToken, newRecoveryCodes } from '@/lib/mfa';

export const runtime = 'nodejs';

const bodySchema = z.object({
  secret: z.string().min(16),
  token: z.string().regex(/^\d{6}$/),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const { secret, token } = parsed.data;

  const ok = await verifyTotpToken({ secret, token });
  if (!ok) {
    await prisma.auditLog.create({
      data: { userId: session.user.id, action: 'MFA_ENROLL_FAILED', metadata: { reason: 'invalid_token' } },
    });
    return NextResponse.json({ error: { code: 'invalid_token' } }, { status: 400 });
  }

  const codes = await newRecoveryCodes();
  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      mfaSecret: secret,
      mfaEnabled: true,
      mfaRecoveryCodes: codes.hashed as unknown as object,
    },
  });

  await prisma.auditLog.create({
    data: { userId: session.user.id, action: 'MFA_ENROLLED' },
  });

  // Returning plain codes ONCE — never persisted in plaintext, never returned again.
  return NextResponse.json({ data: { mfaEnabled: true, recoveryCodes: codes.plain } });
}
