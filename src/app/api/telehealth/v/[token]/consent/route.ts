import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const bodySchema = z.object({
  consentVersion: z.string().min(1).max(80),
});

/**
 * POST /api/telehealth/v/[token]/consent — patient records consent.
 *
 * Patient must be in VERIFIED state. Flips to CONSENT_CAPTURED. The
 * consentVersion captures which version of the consent text was
 * accepted; v1 ships a single "v1-default" string. Wave 3 polish can
 * introduce a ConsentTemplate model with versioned text.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
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
      { error: { code: 'not_verified', message: `Session must be VERIFIED first (current: ${session.status}).` } },
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
