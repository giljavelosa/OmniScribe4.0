import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { writeAuditLog } from '@/lib/audit/log';
import { getPresignedAudioUrl, getPresignedObjectUrl } from '@/lib/s3/client';

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
      deletedAt: null,
    },
    include: {
      addedBy: {
        select: {
          id: true,
          user: { select: { email: true, name: true } },
        },
      },
      extractionBatches: {
        orderBy: { batchIndex: 'asc' },
        select: {
          id: true,
          batchIndex: true,
          pageStart: true,
          pageEnd: true,
          status: true,
          ocrText: true,
          extractionJson: true,
          vettedExtractionJson: true,
          extractionModel: true,
          extractedAt: true,
          reviewedAt: true,
          errorClass: true,
          errorMessage: true,
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
  const documentUrls = await Promise.all(
    row.documentFileKeys.map(async (key, index) => ({
      key,
      mimeType: row.documentMimeTypes[index] ?? null,
      url: await getPresignedObjectUrl(key, 300).catch(() => null),
      previewUrl: `/api/patients/${patientId}/external-context/${ecId}/documents/${index}`,
    })),
  );

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
      mediaKind: row.mediaKind,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
    },
  });

  return NextResponse.json({
    data: {
      id: row.id,
      dateOfRecord: row.dateOfRecord.toISOString(),
      source: row.source,
      sourceLabel: row.sourceLabel,
      status: row.status,
      mediaKind: row.mediaKind,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      verifiedByOrgUserId: row.verifiedByOrgUserId,
      addedAt: row.addedAt.toISOString(),
      episodeOfCareId: row.episodeOfCareId,
      transcriptClean: row.transcriptClean,
      ocrText: row.ocrText,
      extractionJson: row.extractionJson,
      vettedExtractionJson: row.vettedExtractionJson,
      extractionModel: row.extractionModel,
      extractedAt: row.extractedAt?.toISOString() ?? null,
      pageCount: row.pageCount,
      extractionBatches: row.extractionBatches.map((batch) => ({
        id: batch.id,
        batchIndex: batch.batchIndex,
        pageStart: batch.pageStart,
        pageEnd: batch.pageEnd,
        status: batch.status,
        ocrText: batch.ocrText,
        extractionJson: batch.extractionJson,
        vettedExtractionJson: batch.vettedExtractionJson,
        extractionModel: batch.extractionModel,
        extractedAt: batch.extractedAt?.toISOString() ?? null,
        reviewedAt: batch.reviewedAt?.toISOString() ?? null,
        errorClass: batch.errorClass,
        errorMessage: batch.errorMessage,
      })),
      hasAudio: !!row.audioFileKey,
      audioUrl,
      documentUrls,
      addedBy: {
        orgUserId: row.addedBy.id,
        email: row.addedBy.user.email,
        name: row.addedBy.user.name,
      },
    },
  });
}
