import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const bodySchema = z.object({
  newPin: z.string().regex(/^\d{4}$/, 'PIN must be 4 digits'),
  /** Required when rotating an existing PIN. */
  currentPin: z.string().regex(/^\d{4}$/).optional(),
});

/**
 * POST /api/auth/pin/setup — set or rotate the signing PIN.
 *
 * Sprint 0.20 — login verification (MFA) removed. First-time setup is
 * gated only by an authenticated session; rotation requires the current PIN.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request', issues: parsed.error.issues } }, { status: 400 });
  }
  const { newPin, currentPin } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  let authorized = false;
  // First-time setup: an authenticated session is sufficient (Sprint 0.20
  // removed the login-verified gate when MFA was removed).
  if (!user.signingPinHash) {
    authorized = true;
  }
  if (!authorized && currentPin && user.signingPinHash) {
    authorized = await bcrypt.compare(currentPin, user.signingPinHash);
  }
  if (!authorized) {
    return NextResponse.json(
      {
        error: {
          code: 'authorization_failed',
          message: 'Confirm your current signing PIN before changing it.',
        },
      },
      { status: 401 },
    );
  }

  const hash = await bcrypt.hash(newPin, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { signingPinHash: hash, signUnlockedUntil: null },
  });

  await writeAuditLog({
    userId: user.id,
    action: user.signingPinHash ? 'SIGNING_PIN_ROTATED' : 'SIGNING_PIN_SET',
    metadata: { authMethod: currentPin ? 'current_pin' : 'session' },
  });

  return NextResponse.json({ data: { ok: true } });
}
