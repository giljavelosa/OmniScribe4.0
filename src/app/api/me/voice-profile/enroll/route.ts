import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { audioKeyFor, putAudio } from '@/lib/s3/client';
import { enqueueVoiceIdJob } from '@/lib/queue';

export const runtime = 'nodejs';

const MAX_ENROLLMENT_BYTES = 10 * 1024 * 1024; // 10 MB (30–60 s WAV well under this)
const ALLOWED_MIME = new Set(['audio/wav', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4']);

/**
 * POST /api/me/voice-profile/enroll (multipart: audio file)
 *
 * Accepts a 30–60 s enrollment audio sample. Requires that the clinician
 * has already POST /consent (VoiceProfile row must exist with consentedAt set).
 *
 * Side effects:
 *   1. Upload audio to S3 under a voice-profile prefix.
 *   2. Update VoiceProfile.enrollmentS3Key.
 *   3. Enqueue compute-enrollment-embedding job.
 *   4. Audit VOICE_PROFILE_CREATED (updated record).
 */
export async function POST(req: Request) {
  const guard = await requireFeatureAccess('VOICE_PROFILE_MANAGE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const profile = await prisma.voiceProfile.findFirst({
    where: { orgUserId: authorizationUser.orgUserId, isDeleted: false },
    select: { id: true, consentedAt: true },
  });
  if (!profile) {
    return NextResponse.json(
      { error: { code: 'consent_required', message: 'Accept BIPA consent before enrolling.' } },
      { status: 400 },
    );
  }

  const form = await req.formData();
  const audioFile = form.get('audio');
  if (!(audioFile instanceof Blob)) {
    return NextResponse.json({ error: { code: 'bad_request', message: 'audio field missing' } }, { status: 400 });
  }
  if (audioFile.size === 0 || audioFile.size > MAX_ENROLLMENT_BYTES) {
    return NextResponse.json({ error: { code: 'bad_size' } }, { status: 413 });
  }
  const mime = audioFile.type || 'audio/wav';
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: { code: 'bad_mime' } }, { status: 415 });
  }

  const segmentId = `vp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  // Reuse audioKeyFor prefix with a "voice-profiles" pseudo-noteId so the
  // same S3 lifecycle policy covers enrollment audio (Rule 7).
  const s3Key = audioKeyFor(`voice-profile-${authorizationUser.orgUserId}`, segmentId);
  const bytes = Buffer.from(await audioFile.arrayBuffer());

  await putAudio({ key: s3Key, body: bytes, contentType: mime });

  await prisma.voiceProfile.update({
    where: { id: profile.id },
    data: { enrollmentS3Key: s3Key },
  });

  const requestId = randomBytes(8).toString('hex');
  await enqueueVoiceIdJob({
    // noteId field is repurposed to carry the profileId for the embedding job.
    noteId: profile.id,
    orgId: orgUser.orgId,
    type: 'compute-enrollment-embedding',
    requestId,
  });

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'VOICE_PROFILE_CREATED',
    resourceType: 'Note',
    resourceId: profile.id,
    metadata: { byteSize: bytes.byteLength, requestId },
  });

  return NextResponse.json({ data: { ok: true, profileId: profile.id, requestId } });
}
