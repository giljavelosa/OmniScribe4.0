import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { verifyTotpToken } from '@/lib/mfa';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const bodySchema = z.object({
  newPin: z.string().regex(/^\d{4}$/, 'PIN must be 4 digits'),
  /** Required for first-time setup AND for changing an existing PIN. */
  totpToken: z.string().regex(/^\d{6}$/).optional(),
  /** Required only if a PIN already exists and we're rotating without TOTP. */
  currentPin: z.string().regex(/^\d{4}$/).optional(),
});

/**
 * POST /api/auth/pin/setup — set or rotate the signing PIN.
 *
 * For first-time setup: requires a valid TOTP token to authorize.
 * For rotation: accepts EITHER a valid TOTP OR the current PIN.
 *
 * On success the new PIN is bcrypt-hashed at rest. Does NOT unlock signing —
 * the user must POST /verify to start the unlock window.
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
  const { newPin, totpToken, currentPin } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  // Authorize the change. Three accepted paths:
  //   (a) First-time setup AND the active session has mfaVerified=true →
  //       trust the session (no extra TOTP). The user already passed MFA
  //       to reach this page.
  //   (b) Provided a valid TOTP token (any path, e.g. rotating from a
  //       different device).
  //   (c) Rotating an existing PIN with the current PIN.
  const sessionMfaVerified = !!session.user.mfaVerified;
  let authorized = false;
  if (!user.signingPinHash && sessionMfaVerified) {
    authorized = true; // (a)
  }
  if (!authorized && totpToken && user.mfaSecret) {
    authorized = await verifyTotpToken({ secret: user.mfaSecret, token: totpToken }); // (b)
  }
  if (!authorized && currentPin && user.signingPinHash) {
    authorized = await bcrypt.compare(currentPin, user.signingPinHash); // (c)
  }
  if (!authorized) {
    return NextResponse.json(
      { error: { code: 'authorization_failed', message: 'Re-authenticate with TOTP or current PIN before changing the signing PIN.' } },
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
    metadata: { authMethod: totpToken ? 'totp' : 'current_pin' },
  });

  return NextResponse.json({ data: { ok: true } });
}
