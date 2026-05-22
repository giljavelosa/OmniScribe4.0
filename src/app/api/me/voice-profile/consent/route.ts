import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

/** Current BIPA consent text version. Bump when legal text changes. */
export const CURRENT_CONSENT_VERSION = '2026-Q2-v1';

const bodySchema = z.object({
  consentVersion: z.string().min(1),
  displayName: z.string().max(80).optional(),
});

/**
 * POST /api/me/voice-profile/consent
 *
 * Records BIPA consent for the current clinician. Creates or updates the
 * VoiceProfile row with consent metadata. Must be called before the enroll
 * endpoint accepts an audio upload.
 *
 * Body: { consentVersion: string; displayName?: string }
 */
export async function POST(req: Request) {
  const guard = await requireFeatureAccess('VOICE_PROFILE_MANAGE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  if (parsed.data.consentVersion !== CURRENT_CONSENT_VERSION) {
    return NextResponse.json(
      { error: { code: 'stale_consent', message: `Expected consent version ${CURRENT_CONSENT_VERSION}.` } },
      { status: 400 },
    );
  }

  const existing = await prisma.voiceProfile.findFirst({
    where: { orgUserId: authorizationUser.orgUserId, isDeleted: false },
    select: { id: true },
  });

  if (existing) {
    await prisma.voiceProfile.update({
      where: { id: existing.id },
      data: {
        consentVersion: parsed.data.consentVersion,
        consentedAt: new Date(),
        displayName: parsed.data.displayName,
      },
    });
  } else {
    await prisma.voiceProfile.create({
      data: {
        orgUserId: authorizationUser.orgUserId,
        orgId: orgUser.orgId,
        consentVersion: parsed.data.consentVersion,
        consentedAt: new Date(),
        displayName: parsed.data.displayName,
      },
    });
  }

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'VOICE_PROFILE_CREATED',
    resourceType: 'Note',
    resourceId: authorizationUser.orgUserId,
    metadata: { consentVersion: parsed.data.consentVersion },
  });

  return NextResponse.json({ data: { ok: true, consentVersion: parsed.data.consentVersion } });
}
