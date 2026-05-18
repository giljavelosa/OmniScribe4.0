import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { writeAuditLog } from '@/lib/audit/log';
import { getPresignedAudioUrl } from '@/lib/s3/client';

export const runtime = 'nodejs';

/**
 * GET /api/patients/[id]/external-context/[ecId]
 *
 * Detail view — returns the full transcriptClean + an S3 presigned URL for
 * the source audio (when the caller has audio access). Audits
 * EXTERNAL_CONTEXT_VIEWED on success.
 *
 * Spec: context/specs/external-context-upload.md §Endpoints.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; ecId: string }> },
) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id: patientId, ecId } = await params;

  const row = await prisma.externalContext.findFirst({
    where: {
      id: ecId,
      patientId,
      orgId: authorizationUser.orgId,
    },
    include: {
      addedBy: {
        select: {
          id: true,
          user: { select: { email: true, name: true } },
        },
      },
      patient: { select: { orgId: true } },
    },
  });
  if (!row) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(row.patient.orgId, authorizationUser.orgId);

  const audioUrl = row.audioFileKey
    ? await getPresignedAudioUrl(row.audioFileKey, 300).catch(() => null)
    : null;

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'EXTERNAL_CONTEXT_VIEWED',
    resourceType: 'ExternalContext',
    resourceId: ecId,
    metadata: {
      hasAudio: !!row.audioFileKey,
      source: row.source,
      status: row.status,
    },
  });

  return NextResponse.json({
    data: {
      id: row.id,
      dateOfRecord: row.dateOfRecord.toISOString(),
      source: row.source,
      sourceLabel: row.sourceLabel,
      status: row.status,
      addedAt: row.addedAt.toISOString(),
      episodeOfCareId: row.episodeOfCareId,
      transcriptClean: row.transcriptClean,
      hasAudio: !!row.audioFileKey,
      audioUrl,
      addedBy: {
        orgUserId: row.addedBy.id,
        email: row.addedBy.user.email,
        name: row.addedBy.user.name,
      },
    },
  });
}
