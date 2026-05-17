import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { readPatientSessionToken } from '@/lib/telehealth/patient-session';

export const runtime = 'nodejs';

const bodySchema = z.object({
  consentVersion: z.string().min(1).max(80),
});

/**
 * POST /api/telehealth/me/consent — cookie-backed twin of
 * /api/telehealth/v/[token]/consent. The patient is in the waiting room
 * (post-verify), reviews the consent text, and submits. State machine:
 * must be VERIFIED, flips to CONSENT_CAPTURED. Mirrors the token route's
 * error shapes so the client doesn't need to special-case which endpoint
 * it called.
 */
export async function POST(req: Request) {
  const token = await readPatientSessionToken();
  if (!token) return NextResponse.json({ error: { code: 'not_authenticated' } }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const session = await prisma.telehealthSession.findUnique({
    where: { magicToken: token },
  });
  if (!session) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  if (session.status !== 'VERIFIED') {
    return NextResponse.json(
      {
        error: {
          code: 'not_verified',
          message: `Session must be VERIFIED first (current: ${session.status}).`,
        },
      },
      { status: 409 },
    );
  }

  const updated = await prisma.telehealthSession.update({
    where: { id: session.id },
    data: {
      consentAt: new Date(),
      consentVersion: parsed.data.consentVersion,
      status: 'CONSENT_CAPTURED',
    },
  });

  await writeAuditLog({
    orgId: session.orgId,
    action: 'TELEHEALTH_CONSENT_CAPTURED',
    resourceType: 'TelehealthSession',
    resourceId: session.id,
    metadata: {
      scheduleId: session.scheduleId,
      consentVersion: parsed.data.consentVersion,
    },
  });

  return NextResponse.json({ data: { status: updated.status } });
}
