import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

/** GET /api/auth/pin/status — lightweight read of the current user's PIN state. */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { signingPinHash: true, signUnlockedUntil: true },
  });
  if (!user) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  const unlocked =
    !!user.signingPinHash &&
    !!user.signUnlockedUntil &&
    user.signUnlockedUntil.getTime() > Date.now();

  return NextResponse.json({
    data: {
      hasPin: !!user.signingPinHash,
      unlockedUntil: unlocked ? user.signUnlockedUntil!.toISOString() : null,
    },
  });
}
