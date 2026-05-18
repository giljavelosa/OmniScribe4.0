import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { sendTransactional } from '@/lib/email/transport';
import {
  generateMagicToken,
  computeMagicExpiresAt,
} from '@/lib/telehealth/magic-link';

export const runtime = 'nodejs';

const bodySchema = z.object({
  scheduleId: z.string().min(1),
});

/**
 * POST /api/admin/telehealth/sessions — clinic admin creates a telehealth
 * session for an existing TELEHEALTH-typed Schedule. Mints magic token +
 * expiration + emails the patient. Idempotent at the schema layer:
 * scheduleId is @unique on TelehealthSession, so re-POSTing the same
 * scheduleId fails at the DB level → we surface 409 already_exists.
 */
export async function POST(req: Request) {
  const guard = await requireFeatureAccess('VISITS_CREATE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const schedule = await prisma.schedule.findFirst({
    where: { id: parsed.data.scheduleId, orgId: authorizationUser.orgId },
    include: { patient: { select: { id: true, email: true, firstName: true } } },
  });
  if (!schedule) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  if (schedule.visitType !== 'TELEHEALTH') {
    return NextResponse.json(
      { error: { code: 'not_telehealth', message: 'Schedule visitType must be TELEHEALTH.' } },
      { status: 400 },
    );
  }

  // Idempotency — surface a friendly 409 instead of the raw P2002.
  const existing = await prisma.telehealthSession.findUnique({
    where: { scheduleId: schedule.id },
  });
  if (existing) {
    return NextResponse.json(
      { error: { code: 'already_exists', message: 'Session already created for this schedule.' } },
      { status: 409 },
    );
  }

  const token = generateMagicToken();
  const issuedAt = new Date();
  const magicExpiresAt = computeMagicExpiresAt({
    issuedAt,
    scheduledEnd: schedule.scheduledEnd,
  });

  const session = await prisma.telehealthSession.create({
    data: {
      orgId: authorizationUser.orgId,
      scheduleId: schedule.id,
      patientId: schedule.patientId,
      magicToken: token,
      magicExpiresAt,
      createdByOrgUserId: authorizationUser.orgUserId,
    },
  });

  // Best-effort email; if it fails the session row still stands + admin
  // can re-trigger via a future "resend link" surface.
  const magicUrl = `${process.env.APP_BASE_URL ?? 'http://localhost:3000'}/v/${token}`;
  if (schedule.patient.email) {
    try {
      await sendTransactional({
        to: schedule.patient.email,
        subject: 'Your OmniScribe telehealth visit link',
        text: `Hi ${schedule.patient.firstName},\n\nYour clinician scheduled a telehealth visit. Open this link to join:\n${magicUrl}\n\nThe link expires ${magicExpiresAt.toLocaleString()}.\n\n— OmniScribe`,
        html: `<p>Hi ${schedule.patient.firstName},</p><p>Your clinician scheduled a telehealth visit. Open this link to join:</p><p><a href="${magicUrl}">${magicUrl}</a></p><p>The link expires ${magicExpiresAt.toLocaleString()}.</p><p>— OmniScribe</p>`,
      });
    } catch (e) {
      console.warn('[telehealth/sessions] magic link email failed:', e);
    }
  }

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'TELEHEALTH_SESSION_CREATED',
    resourceType: 'TelehealthSession',
    resourceId: session.id,
    metadata: {
      scheduleId: schedule.id,
      patientId: schedule.patientId,
      magicExpiresAt: magicExpiresAt.toISOString(),
      emailDispatchAttempted: !!schedule.patient.email,
    },
  });

  return NextResponse.json(
    {
      data: {
        id: session.id,
        scheduleId: session.scheduleId,
        magicExpiresAt: session.magicExpiresAt.toISOString(),
        // We return the URL so the admin UI can copy/resend manually.
        magicUrl,
      },
    },
    { status: 201 },
  );
}
