import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { auth } from '@/lib/auth';

export type RequirePlatformOwnerOk = { user: Session['user'] };
export type RequirePlatformOwnerResult = RequirePlatformOwnerOk | { error: NextResponse };

export async function requirePlatformOwner(): Promise<RequirePlatformOwnerResult> {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 }) };
  }
  if (session.user.platformRole !== 'PLATFORM_OWNER') {
    return { error: NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 }) };
  }
  if (!session.user.mfaEnabled) {
    return { error: NextResponse.json({ error: { code: 'mfa_required' } }, { status: 403 }) };
  }
  return { user: session.user };
}
