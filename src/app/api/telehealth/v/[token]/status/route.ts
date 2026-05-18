import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

/**
 * GET /api/telehealth/v/[token]/status — patient polls from the waiting
 * room. Returns the minimum surface needed to drive the waiting-room
 * state machine: status + roomUrl (only when ACTIVE).
 *
 * No auth gate — the token IS the auth. Anti-enumeration: unknown
 * tokens return the same 404 shape as deleted sessions.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await prisma.telehealthSession.findUnique({
    where: { magicToken: token },
    select: {
      status: true,
      roomUrl: true,
      scheduleId: true,
      magicExpiresAt: true,
    },
  });
  if (!session) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  // Surface roomUrl ONLY when ACTIVE so a leaked token can't fish for the room.
  return NextResponse.json({
    data: {
      status: session.status,
      scheduleId: session.scheduleId,
      roomUrl: session.status === 'ACTIVE' ? session.roomUrl : null,
      magicExpiresAt: session.magicExpiresAt.toISOString(),
    },
  });
}
