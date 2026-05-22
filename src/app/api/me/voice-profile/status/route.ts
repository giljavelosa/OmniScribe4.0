import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';

export const runtime = 'nodejs';

/**
 * GET /api/me/voice-profile/status
 *
 * Returns the current clinician's voice-profile enrollment state:
 *   { enrolled: false }                             — no profile
 *   { enrolled: true, hasEmbedding, consentVersion, enrolledAt, displayName }
 *
 * Used by /profile/voice to render the appropriate UI state (enroll vs manage).
 */
export async function GET(req: Request) {
  const guard = await requireFeatureAccess('VOICE_PROFILE_MANAGE', req);
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const profile = await prisma.voiceProfile.findFirst({
    where: { orgUserId: authorizationUser.orgUserId, isDeleted: false },
    select: {
      id: true,
      consentVersion: true,
      consentedAt: true,
      displayName: true,
      createdAt: true,
      // embedding is opaque in JS; we just check existence
    },
  });

  // Check if embedding is set via raw query (Prisma can't select vector fields yet).
  let hasEmbedding = false;
  if (profile) {
    const rows = await prisma.$queryRaw<Array<{ has_emb: boolean }>>`
      SELECT (embedding IS NOT NULL) AS has_emb
      FROM "VoiceProfile" WHERE id = ${profile.id}
    `;
    hasEmbedding = rows[0]?.has_emb ?? false;
  }

  if (!profile) {
    return NextResponse.json({ data: { enrolled: false } });
  }

  return NextResponse.json({
    data: {
      enrolled: true,
      hasEmbedding,
      consentVersion: profile.consentVersion,
      enrolledAt: profile.createdAt.toISOString(),
      displayName: profile.displayName,
    },
  });
}
