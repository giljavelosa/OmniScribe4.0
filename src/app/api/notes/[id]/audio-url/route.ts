import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { getPresignedAudioUrl } from '@/lib/s3/client';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

/** TTL for the presigned audio URL — kept short because the URL grants
 *  direct S3 read access. 30 minutes is enough for a clinician to play
 *  the recording back during a viewer session but not long enough to be
 *  useful if the URL ever leaked. */
const AUDIO_URL_TTL_SECONDS = 60 * 30;

/**
 * GET /api/notes/[id]/audio-url
 *
 * Returns a presigned S3 URL for the note's consolidated audio file.
 * Used by the /visits/[noteId] viewer's Recording tab.
 *
 * Returns { data: { url: null } } when Note.audioFileKey is absent
 * (paste-transcript notes never produced audio). Returns 404 only when
 * the note itself is not visible to the caller.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const { id } = await params;

  const note = await prisma.note.findFirst({
    where: { id, orgId: authorizationUser.orgId },
    select: {
      id: true,
      orgId: true,
      clinicianOrgUserId: true,
      audioFileKey: true,
    },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(note.orgId, authorizationUser.orgId);

  if (
    note.clinicianOrgUserId !== authorizationUser.orgUserId &&
    authorizationUser.role !== 'ORG_ADMIN' &&
    authorizationUser.role !== 'VIEWER'
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  if (!note.audioFileKey) {
    return NextResponse.json({ data: { url: null } });
  }

  const url = await getPresignedAudioUrl(note.audioFileKey, AUDIO_URL_TTL_SECONDS);

  // Audit the presigned URL mint — the URL itself grants direct S3 read
  // access, so this is a meaningful PHI surface.
  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'NOTE_AUDIO_URL_GENERATED',
    resourceType: 'Note',
    resourceId: note.id,
    metadata: { ttlSeconds: AUDIO_URL_TTL_SECONDS, surface: 'visit-viewer' },
  });

  return NextResponse.json({ data: { url } });
}
