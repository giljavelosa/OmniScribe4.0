import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  // Cannot index a bcrypt hash, so scan recent unconsumed tokens.
  // For Unit 01 demo scale this is fine; later units can swap to a SHA-256
  // index if reset traffic warrants it.
  const candidates = await prisma.passwordResetToken.findMany({
    where: { consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  for (const c of candidates) {
    if (await bcrypt.compare(token, c.tokenHash)) {
      return NextResponse.json({ data: { ok: true } });
    }
  }
  return NextResponse.json({ error: { code: 'gone' } }, { status: 410 });
}
