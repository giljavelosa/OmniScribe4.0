import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { readPatientSessionToken } from '@/lib/telehealth/patient-session';

export const runtime = 'nodejs';

/**
 * GET /api/telehealth/me/status — cookie-backed twin of
 * /api/telehealth/v/[token]/status, used by the waiting-room poller after
 * the patient has verified DOB and the magic token has been stashed in
 * the httpOnly cookie.
 *
 * Returns the same minimal shape as the token-based variant; surfaces
 * roomUrl ONLY when status is ACTIVE so a hijacked cookie can't fish for
 * the room URL ahead of time.
 */
export async function GET() {
  const token = await readPatientSessionToken();
  if (!token) return NextResponse.json({ error: { code: 'not_authenticated' } }, { status: 401 });

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

  return NextResponse.json({
    data: {
      status: session.status,
      scheduleId: session.scheduleId,
      roomUrl: session.status === 'ACTIVE' ? session.roomUrl : null,
      magicExpiresAt: session.magicExpiresAt.toISOString(),
    },
  });
}
