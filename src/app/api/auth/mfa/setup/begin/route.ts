import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { newMfaSecret, buildOtpAuthUri } from '@/lib/mfa';

export const runtime = 'nodejs';

/**
 * Returns a fresh TOTP secret + otpauth URI for QR rendering.
 * The secret is NOT persisted here — the client posts the secret back to
 * /confirm with the first valid 6-digit token to complete enrollment.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  }

  const secret = await newMfaSecret();
  const uri = await buildOtpAuthUri({ email: session.user.email, secret });
  return NextResponse.json({ data: { secret, uri } });
}
