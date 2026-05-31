import type { Job } from 'bullmq';
import {
  ExternalContextExtractionBatchStatus,
  ExternalContextMediaKind,
  ExternalContextStatus,
  Prisma,
} from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { getObjectBytes } from '@/lib/s3/client';
import { rasterizeExternalContextDocuments } from '@/services/external-context/document-rasterizer';
import { DocumentExtractor } from '@/services/external-context/document-extractor';
import { isFileRouterV2Enabled, routeClinicalFile, type FileRouterDecision } from '@/services/external-context/file-router';
import { TextDocumentExtractor } from '@/services/external-context/text-document-extractor';
import { buildExtractionBatchRanges } from '@/lib/external-context/batches';
import { DOCUMENT_EXTRACTION_BATCH_SIZE, MAX_DOCUMENT_PAGES } from '@/lib/external-context/validation';
import { s3Config } from '@/lib/s3/client';
import {
  buildDocumentPageUpserts,
  documentPagesFromRouterDecisions,
  splitTextIntoDocumentPages,
} from '@/lib/external-context/document-pages';

type ExternalContextExtractionJobData = {
  externalContextId: string;
  orgId: string;
  requestId: string;
};

export async function handle(job: Job<ExternalContextExtractionJobData>) {
  const { externalContextId, orgId, requestId } = job.data;
  const startedAt = Date.now();

  const row = await prisma.externalContext.findFirst({
    where: { id: externalContextId, orgId },
    select: {
      id: true,
      status: true,
      mediaKind: true,
      source: true,
      sourceLabel: true,
      documentFileKeys: true,
      documentMimeTypes: true,
      deletedAt: true,
      verifiedAt: true,
      extractionBatches: {
        orderBy: { batchIndex: 'asc' },
        select: {
          id: true,
          batchIndex: true,
          pageStart: true,
          pageEnd: true,
          status: true,
        },
      },
    },
  });

  if (!row) {
    console.warn(`[external-ctx-extraction] row ${externalContextId} not found — dropping job`);
    return { skipped: 'not_found' };
  }
  if (row.deletedAt) return { skipped: 'deleted' };
  if (row.verifiedAt) return { skipped: 'verified' };
  if (row.mediaKind !== ExternalContextMediaKind.DOCUMENT) {
    return { skipped: `mediaKind=${row.mediaKind}` };
  }
  if (row.status !== ExternalContextStatus.PENDING_EXTRACTION) {
    return { skipped: `status=${row.status}` };
  }
  if (row.documentFileKeys.length === 0) {
    await markFailed({
      externalContextId,
      orgId,
      errorClass: 'MissingDocumentFileKeys',
      errorMessage: 'Document file keys missing',
      attempt: job.attemptsMade + 1,
      source: row.source,
      requestId,
      batchId: null,
    });
    throw new Error(`external-ctx ${externalContextId}: documentFileKeys missing`);
  }

  let activeBatch:
    | {
        id: string;
        batchIndex: number;
        pageStart: number;
        pageEnd: number;
        status: ExternalContextExtractionBatchStatus;
      }
    | null = null;

  try {
    const documents = await Promise.all(
      row.documentFileKeys.map(async (key, index) => ({
        bytes: await getObjectBytes(key),
        mimeType: row.documentMimeTypes[index] ?? 'application/octet-stream',
        key,
        label: `document ${index + 1}`,
      })),
    );

    if (isFileRouterV2Enabled()) {
      const routerResult = await handleRouterV2Documents({
        documents,
        row,
        externalContextId,
        orgId,
        requestId,
        startedAt,
      });
      if (routerResult) return routerResult;
    }

    let rasterized = null as Awaited<ReturnType<typeof rasterizeExternalContextDocuments>> | null;

    if (row.extractionBatches.length === 0) {
      rasterized = await rasterizeExternalContextDocuments(documents, {
        pageStart: 1,
        pageEnd: DOCUMENT_EXTRACTION_BATCH_SIZE,
        maxPages: MAX_DOCUMENT_PAGES,
      });
      const ranges = buildExtractionBatchRanges(rasterized.pageCount);
      if (ranges.length === 0) {
        throw new Error('Document has no pages available for extraction.');
      }
      await prisma.$transaction([
        prisma.externalContext.update({
          where: { id: externalContextId },
          data: { pageCount: rasterized.pageCount },
        }),
        prisma.externalContextExtractionBatch.createMany({
          data: ranges.map((range) => ({
            orgId,
            externalContextId,
            batchIndex: range.batchIndex,
            pageStart: range.pageStart,
            pageEnd: range.pageEnd,
            status: ExternalContextExtractionBatchStatus.PENDING,
          })),
          skipDuplicates: true,
        }),
      ]);
    }

    activeBatch = await prisma.externalContextExtractionBatch.findFirst({
      where: {
        externalContextId,
        orgId,
        status: ExternalContextExtractionBatchStatus.PROCESSING,
      },
      orderBy: { batchIndex: 'asc' },
      select: { id: true, batchIndex: true, pageStart: true, pageEnd: true, status: true },
    });

    if (activeBatch) {
      await prisma.externalContextExtractionBatch.updateMany({
        where: {
          externalContextId,
          orgId,
          status: ExternalContextExtractionBatchStatus.PROCESSING,
          batchIndex: { gt: activeBatch.batchIndex },
        },
        data: {
          status: ExternalContextExtractionBatchStatus.PENDING,
          errorClass: null,
          errorMessage: null,
        },
      });
    }

    activeBatch ??= await prisma.externalContextExtractionBatch.findFirst({
      where: {
        externalContextId,
        orgId,
        status: ExternalContextExtractionBatchStatus.PENDING,
      },
      orderBy: { batchIndex: 'asc' },
      select: { id: true, batchIndex: true, pageStart: true, pageEnd: true, status: true },
    });

    if (!activeBatch) {
      return { skipped: 'no_pending_batch' };
    }

    if (activeBatch.status !== ExternalContextExtractionBatchStatus.PROCESSING) {
      await prisma.externalContextExtractionBatch.update({
        where: { id: activeBatch.id },
        data: {
          status: ExternalContextExtractionBatchStatus.PROCESSING,
          errorClass: null,
          errorMessage: null,
        },
      });
    }

    rasterized ??= await rasterizeExternalContextDocuments(documents, {
      pageStart: activeBatch.pageStart,
      pageEnd: activeBatch.pageEnd,
      maxPages: MAX_DOCUMENT_PAGES,
    });
    const extractor = new DocumentExtractor();
    const result = await extractor.extract({
      orgId,
      externalContextId,
      sourceLabel: row.sourceLabel,
      images: rasterized.images,
    });

    const extractedAt = new Date();
    const applied = await applyExtractionResultIfStillPending({
      orgId,
      externalContextId,
      batchId: activeBatch.id,
      ocrText: result.envelope.ocrText,
      extraction: result.envelope.extraction,
      extractionModel: result.model,
      pageCount: rasterized.pageCount,
      pages: splitTextIntoDocumentPages(result.envelope.ocrText, {
        pageCount: rasterized.pageCount,
      }),
      extractedAt,
    });
    if (!applied.applied) return { skipped: applied.skipped };

    await writeAuditLog({
      orgId,
      action: 'EXTERNAL_CONTEXT_BATCH_EXTRACTED',
      resourceType: 'ExternalContext',
      resourceId: externalContextId,
      metadata: {
        durationMs: Date.now() - startedAt,
        source: row.source,
        requestId,
        model: result.model,
        stub: result.stub,
        batchId: activeBatch.id,
        batchIndex: activeBatch.batchIndex,
        pageStart: activeBatch.pageStart,
        pageEnd: activeBatch.pageEnd,
        pageCount: rasterized.pageCount,
        attachedImageCount: rasterized.images.length,
        maxProcessedPages: Math.min(rasterized.pageCount, MAX_DOCUMENT_PAGES),
        diagnosisCount: result.envelope.extraction.diagnoses.length,
        medicationCount: result.envelope.extraction.medications.length,
        allergyCount: result.envelope.extraction.allergies.length,
        labCount: result.envelope.extraction.labs.length,
        vitalCount: result.envelope.extraction.vitals.length,
        procedureCount: result.envelope.extraction.procedures.length,
      },
    });

    return { ok: true, externalContextId, batchId: activeBatch.id };
  } catch (err) {
    const errorClass = err instanceof Error ? err.name : 'Unknown';
    const errorMessage = err instanceof Error ? err.message : String(err);
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts?.attempts ?? 3;
    const isFinalAttempt = attempt >= maxAttempts;

    if (isFinalAttempt) {
      await markFailed({
        externalContextId,
        orgId,
        errorClass,
        errorMessage,
        attempt,
        source: row.source,
        requestId,
        batchId: activeBatch?.id ?? null,
      });
    }
    throw err;
  }
}

async function handleRouterV2Documents(args: {
  documents: Array<{ bytes: Buffer; mimeType: string; key: string; label: string }>;
  row: {
    id: string;
    source: string;
    sourceLabel: string | null;
    extractionBatches: Array<{
      id: string;
      batchIndex: number;
      pageStart: number;
      pageEnd: number;
      status: ExternalContextExtractionBatchStatus;
    }>;
  };
  externalContextId: string;
  orgId: string;
  requestId: string;
  startedAt: number;
}): Promise<{ ok: true; externalContextId: string; batchId: string; route: string } | null> {
  const decisions: FileRouterDecision[] = [];
  for (const [index, document] of args.documents.entries()) {
    const decision = await routeClinicalFile({
      documentId: `${args.externalContextId}:${index}`,
      bytes: document.bytes,
      mimeType: document.mimeType,
      fileName: document.key,
      s3Object: s3Config.bucket ? { bucket: s3Config.bucket, key: document.key } : undefined,
    });
    decisions.push(decision);
  }

  if (decisions.some((decision) => decision.route === 'image_fast_path')) {
    return null;
  }

  const pageCount = decisions.reduce((sum, decision) => sum + decision.pageCount, 0);
  const text = decisions
    .map((decision, index) => `File ${index + 1} route=${decision.route}\n${decision.text}`)
    .join('\n\n');
  const pageEnd = Math.max(1, pageCount);

  let activeBatch = await prisma.externalContextExtractionBatch.findFirst({
    where: {
      externalContextId: args.externalContextId,
      orgId: args.orgId,
      status: {
        in: [
          ExternalContextExtractionBatchStatus.PROCESSING,
          ExternalContextExtractionBatchStatus.PENDING,
        ],
      },
    },
    orderBy: { batchIndex: 'asc' },
    select: { id: true, batchIndex: true, pageStart: true, pageEnd: true, status: true },
  });

  if (!activeBatch) {
    await prisma.$transaction([
      prisma.externalContext.update({
        where: { id: args.externalContextId },
        data: { pageCount },
      }),
      prisma.externalContextExtractionBatch.createMany({
        data: [
          {
            orgId: args.orgId,
            externalContextId: args.externalContextId,
            batchIndex: 0,
            pageStart: 1,
            pageEnd,
            status: ExternalContextExtractionBatchStatus.PENDING,
          },
        ],
        skipDuplicates: true,
      }),
    ]);
    activeBatch = await prisma.externalContextExtractionBatch.findFirst({
      where: {
        externalContextId: args.externalContextId,
        orgId: args.orgId,
        status: ExternalContextExtractionBatchStatus.PENDING,
      },
      orderBy: { batchIndex: 'asc' },
      select: { id: true, batchIndex: true, pageStart: true, pageEnd: true, status: true },
    });
  }

  if (!activeBatch) {
    throw new Error('Router V2 could not create an extraction review batch.');
  }

  if (activeBatch.status !== ExternalContextExtractionBatchStatus.PROCESSING) {
    await prisma.externalContextExtractionBatch.update({
      where: { id: activeBatch.id },
      data: {
        status: ExternalContextExtractionBatchStatus.PROCESSING,
        errorClass: null,
        errorMessage: null,
      },
    });
  }

  const llmStartedAt = new Date();
  const extractor = new TextDocumentExtractor();
  const result = await extractor.extract({
    orgId: args.orgId,
    externalContextId: args.externalContextId,
    sourceLabel: args.row.sourceLabel,
    text,
    route: decisions.map((decision) => decision.route).join('+'),
  });
  const llmCompletedAt = new Date();

  const extractedAt = new Date();
  const documentPages = documentPagesFromRouterDecisions(decisions);
  const applied = await applyExtractionResultIfStillPending({
    orgId: args.orgId,
    externalContextId: args.externalContextId,
    batchId: activeBatch.id,
    ocrText: result.envelope.ocrText,
    extraction: result.envelope.extraction,
    extractionModel: result.model,
    pageCount,
    pages: documentPages.length > 0
      ? documentPages
      : splitTextIntoDocumentPages(result.envelope.ocrText, { pageCount }),
    extractedAt,
  });
  if (!applied.applied) {
    return {
      ok: true,
      externalContextId: args.externalContextId,
      batchId: activeBatch.id,
      route: applied.skipped,
    };
  }

  await writeAuditLog({
    orgId: args.orgId,
    action: 'EXTERNAL_CONTEXT_BATCH_EXTRACTED',
    resourceType: 'ExternalContext',
    resourceId: args.externalContextId,
    metadata: {
      durationMs: Date.now() - args.startedAt,
      source: args.row.source,
      requestId: args.requestId,
      model: result.model,
      stub: result.stub,
      batchId: activeBatch.id,
      batchIndex: activeBatch.batchIndex,
      pageStart: activeBatch.pageStart,
      pageEnd: activeBatch.pageEnd,
      pageCount,
      routerVersion: 'v2',
      detectedRoutes: decisions.map((decision) => decision.route),
      ocrUsed: decisions.some((decision) => decision.ocrUsed),
      textLayerUsable: decisions.every((decision) => decision.route !== 'pdf_ocr'),
      timings: {
        upload_received_at: decisions[0]?.timings.uploadReceivedAt ?? null,
        file_type_detected_at: decisions[0]?.timings.fileTypeDetectedAt ?? null,
        text_layer_checked_at: decisions[0]?.timings.textLayerCheckedAt ?? null,
        text_extraction_started_at: decisions[0]?.timings.textExtractionStartedAt ?? null,
        text_extraction_completed_at: decisions[0]?.timings.textExtractionCompletedAt ?? null,
        textract_or_ocr_job_submitted_at: decisions[0]?.timings.ocrJobSubmittedAt ?? null,
        textract_or_ocr_job_completed_at: decisions[0]?.timings.ocrJobCompletedAt ?? null,
        normalization_completed_at: decisions[0]?.timings.normalizationCompletedAt ?? null,
        llm_extraction_started_at: llmStartedAt.toISOString(),
        llm_extraction_completed_at: llmCompletedAt.toISOString(),
        clinician_review_ready_at: decisions[0]?.timings.clinicianReviewReadyAt ?? extractedAt.toISOString(),
      },
      extractedCharacterCount: result.envelope.ocrText.length,
      diagnosisCount: result.envelope.extraction.diagnoses.length,
      medicationCount: result.envelope.extraction.medications.length,
      allergyCount: result.envelope.extraction.allergies.length,
      labCount: result.envelope.extraction.labs.length,
      vitalCount: result.envelope.extraction.vitals.length,
      procedureCount: result.envelope.extraction.procedures.length,
    },
  });

  return {
    ok: true,
    externalContextId: args.externalContextId,
    batchId: activeBatch.id,
    route: decisions.map((decision) => decision.route).join('+'),
  };
}

async function markFailed(args: {
  externalContextId: string;
  orgId: string;
  errorClass: string;
  errorMessage: string;
  attempt: number;
  source: string;
  requestId: string;
  batchId: string | null;
}): Promise<void> {
  if (await isExtractionLocked(args.externalContextId, args.orgId)) return;
  await prisma.$transaction([
    ...(args.batchId
      ? [
          prisma.externalContextExtractionBatch.update({
            where: { id: args.batchId },
            data: {
              status: ExternalContextExtractionBatchStatus.FAILED,
              errorClass: args.errorClass,
              errorMessage: args.errorMessage.slice(0, 600),
            },
          }),
        ]
      : []),
    prisma.externalContext.update({
      where: { id: args.externalContextId },
      data: { status: ExternalContextStatus.EXTRACTION_FAILED },
    }),
  ]);
  await writeAuditLog({
    orgId: args.orgId,
    action: 'EXTERNAL_CONTEXT_EXTRACTION_FAILED',
    resourceType: 'ExternalContext',
    resourceId: args.externalContextId,
    metadata: {
      errorClass: args.errorClass,
      attempt: args.attempt,
      source: args.source,
      requestId: args.requestId,
      batchId: args.batchId,
    },
  });
}

async function applyExtractionResultIfStillPending(args: {
  orgId: string;
  externalContextId: string;
  batchId: string;
  ocrText: string;
  extraction: unknown;
  extractionModel: string;
  pageCount: number;
  pages: ReturnType<typeof splitTextIntoDocumentPages>;
  extractedAt: Date;
}): Promise<{ applied: true } | { applied: false; skipped: string }> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.externalContext.findFirst({
      where: { id: args.externalContextId, orgId: args.orgId },
      select: { deletedAt: true, verifiedAt: true, status: true },
    });
    if (!current) return { applied: false as const, skipped: 'not_found_after_extraction' };
    if (current.deletedAt) return { applied: false as const, skipped: 'deleted_after_extraction' };
    if (current.verifiedAt) return { applied: false as const, skipped: 'verified_after_extraction' };
    if (current.status !== ExternalContextStatus.PENDING_EXTRACTION) {
      return { applied: false as const, skipped: `status=${current.status}_after_extraction` };
    }

    const batchUpdate = await tx.externalContextExtractionBatch.updateMany({
      where: {
        id: args.batchId,
        externalContextId: args.externalContextId,
        orgId: args.orgId,
        status: ExternalContextExtractionBatchStatus.PROCESSING,
      },
      data: {
        status: ExternalContextExtractionBatchStatus.NEEDS_REVIEW,
        ocrText: args.ocrText,
        extractionJson: args.extraction as Prisma.InputJsonValue,
        extractionModel: args.extractionModel,
        extractedAt: args.extractedAt,
      },
    });
    if (batchUpdate.count === 0) {
      return { applied: false as const, skipped: 'batch_not_processing_after_extraction' };
    }

    await tx.externalContext.update({
      where: { id: args.externalContextId },
      data: {
        status: ExternalContextStatus.PARTIAL_EXTRACTION_REVIEW,
        ocrText: args.ocrText,
        extractionJson: args.extraction as Prisma.InputJsonValue,
        extractionModel: args.extractionModel,
        pageCount: args.pageCount,
        extractedAt: args.extractedAt,
      },
    });
    for (const upsert of buildDocumentPageUpserts({
      client: tx,
      orgId: args.orgId,
      externalContextId: args.externalContextId,
      pages: args.pages,
      extractedAt: args.extractedAt,
    })) {
      await upsert;
    }
    return { applied: true as const };
  });
}

async function isExtractionLocked(externalContextId: string, orgId: string): Promise<boolean> {
  const row = await prisma.externalContext.findFirst({
    where: { id: externalContextId, orgId },
    select: { deletedAt: true, verifiedAt: true, status: true },
  });
  return !row
    || !!row.deletedAt
    || !!row.verifiedAt
    || row.status !== ExternalContextStatus.PENDING_EXTRACTION;
}
