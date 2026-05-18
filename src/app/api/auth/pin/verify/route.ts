import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const bodySchema = z.object({
  pin: z.string().regex(/^\d{4}$/),
});

/** Unlock window after a successful PIN verify — within this window, sign
 *  actions skip re-auth. Tuned to a typical Epic-style clinic session. */
const UNLOCK_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/**
 * POST /api/auth/pin/verify — confirm signing PIN and start unlock window.
 *
 * On success: User.signUnlockedUntil = now + 30 minutes. The /sign route
 * honors this window — no extra MFA / PIN re-prompt until it expires.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const { pin } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  if (!user.signingPinHash) {
    return NextResponse.json({ error: { code: 'pin_not_set' } }, { status: 409 });
  }

  const ok = await bcrypt.compare(pin, user.signingPinHash);

  await writeAuditLog({
    userId: user.id,
    action: ok ? 'SIGNING_PIN_VERIFIED' : 'SIGNING_PIN_VERIFY_FAILED',
  });

  if (!ok) {
    return NextResponse.json({ error: { code: 'invalid_pin' } }, { status: 401 });
  }

  const unlockedUntil = new Date(Date.now() + UNLOCK_WINDOW_MS);
  await prisma.user.update({
    where: { id: user.id },
    data: { signUnlockedUntil: unlockedUntil },
  });

  return NextResponse.json({ data: { ok: true, unlockedUntil: unlockedUntil.toISOString() } });
}
