import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { sendTransactional } from '@/lib/email/transport';
import { buildPasswordResetEmail } from '@/lib/email/templates/password-reset';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const TOKEN_TTL_HOURS = 1;
const TOKEN_BYTES = 32;
const HASH_ROUNDS = 12;

const bodySchema = z.object({
  email: z.email().transform((s) => s.toLowerCase()),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const { email } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });

  // Always behave identically whether or not the email exists — anti-enumeration.
  if (user) {
    const rawToken = randomBytes(TOKEN_BYTES).toString('hex');
    const tokenHash = await bcrypt.hash(rawToken, HASH_ROUNDS);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
    const resetUrl = `${base}/password-reset/confirm?token=${rawToken}`;

    await sendTransactional(
      buildPasswordResetEmail({ to: user.email, resetUrl, expiresInHours: TOKEN_TTL_HOURS }),
    );

    await writeAuditLog({ userId: user.id, action: 'PASSWORD_RESET_REQUESTED', metadata: { method: 'self' } });
  } else {
    // Still log the attempt (without raw email) so SOC can see request volume.
    await writeAuditLog({ action: 'PASSWORD_RESET_REQUESTED', metadata: { method: 'self', unknown_email: true } });
  }

  return NextResponse.json({ data: { ok: true } });
}
