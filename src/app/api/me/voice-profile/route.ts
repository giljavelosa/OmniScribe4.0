import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

/**
 * DELETE /api/me/voice-profile — revoke the current clinician's enrollment.
 *
 * Soft-deletes the VoiceProfile row (isDeleted=true, hardDeleteAt=now+30d).
 * Audits VOICE_PROFILE_REVOKED. The enrollment audio in S3 is NOT deleted
 * (Rule 7 analogue — soft-delete in DB only).
 */
export async function DELETE(req: Request) {
  const guard = await requireFeatureAccess('VOICE_PROFILE_MANAGE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const profile = await prisma.voiceProfile.findFirst({
    where: { orgUserId: authorizationUser.orgUserId, isDeleted: false },
    select: { id: true },
  });
  if (!profile) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const hardDeleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await prisma.voiceProfile.update({
    where: { id: profile.id },
    data: { isDeleted: true, deletedAt: new Date(), hardDeleteAt },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'VOICE_PROFILE_REVOKED',
    resourceType: 'Note',
    resourceId: profile.id,
    metadata: { hardDeleteAt: hardDeleteAt.toISOString() },
  });

  return NextResponse.json({ data: { ok: true } });
}
