import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { isExpired, verifyDobAgainst } from '@/lib/telehealth/magic-link';
import { setPatientSessionCookie } from '@/lib/telehealth/patient-session';

export const runtime = 'nodejs';

const bodySchema = z.object({
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * POST /api/telehealth/v/[token]/verify — patient submits DOB.
 *
 * Anti-enumeration: every failure path (unknown token, expired,
 * consumed, DOB mismatch) returns the SAME response shape:
 * `{ error: { code: 'invalid' } }` with status 401. The audit row
 * captures the internal reason for ops triage; the wire never reveals
 * which check failed.
 *
 * On success: flips status to VERIFIED + sets verifiedAt + returns the
 * scheduleId so the page can redirect to /telehealth/waiting/[scheduleId].
 *
 * No auth gate — the token IS the auth. The endpoint is patient-facing.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'invalid' } }, { status: 401 });
  }

  const session = await prisma.telehealthSession.findUnique({
    where: { magicToken: token },
    include: { patient: { select: { id: true, dob: true } } },
  });

  // Generic failure helper so every reject looks identical from the wire.
  // Audit writes must NOT be swallowed (rule 8); let any failure propagate to
  // the caller's 500 so ops sees enumeration-attempt visibility loss instead
  // of a silent gap in the audit trail.
  async function fail(reason: string, sessionId: string | null) {
    if (sessionId) {
      const s = await prisma.telehealthSession.findUnique({ where: { id: sessionId } });
      if (s) {
        await writeAuditLog({
          orgId: s.orgId,
          action: 'TELEHEALTH_MAGIC_LINK_FAILED',
          resourceType: 'TelehealthSession',
          resourceId: s.id,
          metadata: { reason, scheduleId: s.scheduleId },
        });
      }
    }
    return NextResponse.json({ error: { code: 'invalid' } }, { status: 401 });
  }

  if (!session) return fail('unknown_token', null);
  if (session.verifiedAt) return fail('already_consumed', session.id);
  if (isExpired(session.magicExpiresAt)) {
    await prisma.telehealthSession.update({
      where: { id: session.id },
      data: { status: 'EXPIRED' },
    });
    return fail('expired', session.id);
  }
  if (!verifyDobAgainst(session.patient.dob, parsed.data.dob)) {
    return fail('dob_mismatch', session.id);
  }

  const updated = await prisma.telehealthSession.update({
    where: { id: session.id },
    data: {
      verifiedAt: new Date(),
      status: 'VERIFIED',
    },
  });

  await writeAuditLog({
    orgId: session.orgId,
    action: 'TELEHEALTH_PATIENT_VERIFIED',
    resourceType: 'TelehealthSession',
    resourceId: session.id,
    metadata: { scheduleId: session.scheduleId },
  });

  const response = NextResponse.json({
    data: { scheduleId: updated.scheduleId, status: updated.status },
  });
  // Move the magic token out of the URL into an httpOnly cookie so the
  // waiting room never has to handle it client-side. /me/status + /me/consent
  // resolve it from the cookie.
  setPatientSessionCookie(response, token);
  return response;
}
