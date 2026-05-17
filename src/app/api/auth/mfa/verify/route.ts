import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { verifyTotpToken, consumeRecoveryCode } from '@/lib/mfa';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const bodySchema = z.object({
  token: z.string().min(1),
  useRecoveryCode: z.boolean().optional(),
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
  const { token, useRecoveryCode } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || !user.mfaSecret) {
    return NextResponse.json({ error: { code: 'mfa_not_enrolled' } }, { status: 400 });
  }

  let ok = false;
  if (useRecoveryCode) {
    const hashed = Array.isArray(user.mfaRecoveryCodes)
      ? (user.mfaRecoveryCodes as unknown as string[])
      : [];
    const idx = await consumeRecoveryCode(token, hashed);
    if (idx >= 0) {
      const remaining = hashed.filter((_, i) => i !== idx);
      await prisma.user.update({
        where: { id: user.id },
        data: { mfaRecoveryCodes: remaining as unknown as object },
      });
      ok = true;
    }
  } else {
    ok = await verifyTotpToken({ secret: user.mfaSecret, token });
  }

  await writeAuditLog({
    userId: user.id,
    action: ok ? 'MFA_VERIFIED' : 'MFA_VERIFY_FAILED',
    metadata: { method: useRecoveryCode ? 'recovery_code' : 'totp' },
  });

  if (!ok) {
    return NextResponse.json({ error: { code: 'invalid_code' } }, { status: 401 });
  }

  return NextResponse.json({ data: { mfaVerified: true } });
}
