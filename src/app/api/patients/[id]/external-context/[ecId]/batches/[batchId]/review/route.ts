import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  ExternalContextExtractionBatchStatus,
  ExternalContextMediaKind,
  ExternalContextStatus,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { writeAuditLog } from '@/lib/audit/log';
import { enqueueExternalContextExtractionJob } from '@/lib/queue';
import { mergeReviewedExtractionBatches } from '@/lib/external-context/batch-merge';
import { ExtractionJsonSchema } from '@/types/external-context-extraction';

export const runtime = 'nodejs';

const bodySchema = z.object({
  extraction: ExtractionJsonSchema,
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; ecId: string; batchId: string }> },
) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id: patientId, ecId, batchId } = await params;
  const row = await prisma.externalContext.findFirst({
    where: { id: ecId, patientId, orgId: authorizationUser.orgId },
    select: {
      id: true,
      orgId: true,
      patientId: true,
      mediaKind: true,
      status: true,
      verifiedAt: true,
      deletedAt: true,
      patient: { select: { orgId: true } },
    },
  });
  if (!row) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(row.patient.orgId, authorizationUser.orgId);

  if (row.mediaKind !== ExternalContextMediaKind.DOCUMENT) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Only document rows have extraction batches.' } },
      { status: 400 },
    );
  }
  if (row.deletedAt) {
    return NextResponse.json(
      { error: { code: 'gone', message: 'This document has been discarded.' } },
      { status: 410 },
    );
  }
  if (row.verifiedAt) {
    return NextResponse.json(
      { error: { code: 'conflict', message: 'This document is already verified.' } },
      { status: 409 },
    );
  }
  if (row.status !== ExternalContextStatus.PARTIAL_EXTRACTION_REVIEW) {
    return NextResponse.json(
      { error: { code: 'conflict', message: 'No extracted batch is awaiting review.' } },
      { status: 409 },
    );
  }

  const batch = await prisma.externalContextExtractionBatch.findFirst({
    where: { id: batchId, externalContextId: row.id, orgId: authorizationUser.orgId },
    select: {
      id: true,
      batchIndex: true,
      pageStart: true,
      pageEnd: true,
      status: true,
    },
  });
  if (!batch) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  if (batch.status !== ExternalContextExtractionBatchStatus.NEEDS_REVIEW) {
    return NextResponse.json(
      { error: { code: 'conflict', message: 'This batch is not awaiting clinician review.' } },
      { status: 409 },
    );
  }

  const reviewedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await tx.externalContextExtractionBatch.update({
      where: { id: batch.id },
      data: {
        status: ExternalContextExtractionBatchStatus.REVIEWED,
        vettedExtractionJson: parsed.data.extraction as unknown as Prisma.InputJsonValue,
        reviewedAt,
        reviewedByOrgUserId: orgUser.id,
      },
    });

    const batches = await tx.externalContextExtractionBatch.findMany({
      where: { externalContextId: row.id, orgId: authorizationUser.orgId },
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
      },
    });

    const nextBatch = batches.find((candidate) =>
      candidate.status === ExternalContextExtractionBatchStatus.PENDING,
    ) ?? null;

    if (nextBatch) {
      await tx.externalContext.update({
        where: { id: row.id },
        data: { status: ExternalContextStatus.PENDING_EXTRACTION },
      });
      return {
        documentComplete: false as const,
        nextBatch,
        batches,
        merged: null,
      };
    }

    const allReviewed = batches.every((candidate) =>
      candidate.status === ExternalContextExtractionBatchStatus.REVIEWED,
    );
    if (!allReviewed) {
      throw new Error('Reviewed batch state is inconsistent; no pending batch remains.');
    }

    const merged = mergeReviewedExtractionBatches(batches);
    const models = Array.from(new Set(batches.map((candidate) => candidate.extractionModel).filter(Boolean)));
    await tx.externalContext.update({
      where: { id: row.id },
      data: {
        status: ExternalContextStatus.EXTRACTED,
        ocrText: merged.ocrText,
        extractionJson: merged.extraction as unknown as Prisma.InputJsonValue,
        extractionModel: models.length > 0 ? models.join(',') : null,
        extractedAt: reviewedAt,
      },
    });
    return {
      documentComplete: true as const,
      nextBatch: null,
      batches,
      merged,
    };
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'EXTERNAL_CONTEXT_BATCH_REVIEWED',
    resourceType: 'ExternalContext',
    resourceId: row.id,
    metadata: {
      patientId: row.patientId,
      batchId: batch.id,
      batchIndex: batch.batchIndex,
      pageStart: batch.pageStart,
      pageEnd: batch.pageEnd,
      reviewerOrgUserId: orgUser.id,
      documentComplete: result.documentComplete,
      diagnosisCount: parsed.data.extraction.diagnoses.length,
      medicationCount: parsed.data.extraction.medications.length,
      allergyCount: parsed.data.extraction.allergies.length,
      labCount: parsed.data.extraction.labs.length,
      vitalCount: parsed.data.extraction.vitals.length,
      procedureCount: parsed.data.extraction.procedures.length,
    },
  });

  let requestId: string | null = null;
  if (result.nextBatch) {
    requestId = randomBytes(8).toString('hex');
    await enqueueExternalContextExtractionJob({
      externalContextId: row.id,
      orgId: authorizationUser.orgId,
      requestId,
    });
  } else {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'EXTERNAL_CONTEXT_EXTRACTION_COMPLETED',
      resourceType: 'ExternalContext',
      resourceId: row.id,
      metadata: {
        patientId: row.patientId,
        batchCount: result.batches.length,
        reviewedBatchCount: result.batches.length,
        diagnosisCount: result.merged?.extraction.diagnoses.length ?? 0,
        medicationCount: result.merged?.extraction.medications.length ?? 0,
        allergyCount: result.merged?.extraction.allergies.length ?? 0,
        labCount: result.merged?.extraction.labs.length ?? 0,
        vitalCount: result.merged?.extraction.vitals.length ?? 0,
        procedureCount: result.merged?.extraction.procedures.length ?? 0,
      },
    });
  }

  return NextResponse.json({
    data: {
      id: row.id,
      status: result.documentComplete
        ? ExternalContextStatus.EXTRACTED
        : ExternalContextStatus.PENDING_EXTRACTION,
      batchId: batch.id,
      reviewedAt: reviewedAt.toISOString(),
      nextBatch: result.nextBatch
        ? {
            id: result.nextBatch.id,
            batchIndex: result.nextBatch.batchIndex,
            pageStart: result.nextBatch.pageStart,
            pageEnd: result.nextBatch.pageEnd,
          }
        : null,
      requestId,
      documentComplete: result.documentComplete,
      extractionJson: result.merged?.extraction ?? null,
      ocrText: result.merged?.ocrText ?? null,
    },
  });
}
