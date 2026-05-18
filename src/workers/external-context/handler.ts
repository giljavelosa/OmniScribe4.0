import type { Job } from 'bullmq';
import { ExternalContextStatus, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import {
  cleanBatchTranscript,
  transcribeBatch,
  sonioxConfig,
} from '@/services/transcription';
import { getAudioBytes } from '@/lib/s3/client';

type ExternalContextJobData = {
  externalContextId: string;
  orgId: string;
  requestId: string;
};

/**
 * external-context-transcription worker.
 *
 * Spec: context/specs/external-context-upload.md §Worker.
 *
 * Triggered by the upload-mode POST after audio bytes land in S3. Pulls the
 * audio back, runs Soniox batch (rule 11 — only path through
 * SonioxService.transcribeBatch), cleans the result via
 * cleanBatchTranscript, writes transcriptClean + transcriptRaw, flips status
 * PENDING_TRANSCRIPTION → READY.
 *
 * Idempotency: queue.ts uses `external-ctx:{id}:{requestId}` so a duplicate
 * enqueue collapses to one Redis entry. Within the handler we also guard on
 * status — a re-entry against a READY/FAILED row is a no-op.
 *
 * Error handling: errors bubble (rule 8 — never swallowed). BullMQ retries
 * 3× with exponential backoff per the default queue options. On the final
 * failed attempt the handler flips status → FAILED and writes the
 * EXTERNAL_CONTEXT_TRANSCRIPTION_FAILED audit so the UI can surface a
 * retry / contact-support state instead of a forever-spinning badge.
 */
export async function handle(job: Job<ExternalContextJobData>) {
  const { externalContextId, orgId, requestId } = job.data;
  const startedAt = Date.now();

  const row = await prisma.externalContext.findFirst({
    where: { id: externalContextId, orgId },
    select: {
      id: true,
      status: true,
      source: true,
      audioFileKey: true,
    },
  });
  if (!row) {
    console.warn(`[external-ctx] row ${externalContextId} not found — dropping job`);
    return { skipped: 'not_found' };
  }
  if (row.status !== ExternalContextStatus.PENDING_TRANSCRIPTION) {
    return { skipped: `status=${row.status}` };
  }
  if (!row.audioFileKey) {
    // Upload-mode rows always have audioFileKey set by the POST. If we land
    // here something has gone wrong upstream — flip to FAILED so the UI
    // doesn't spin forever and the auditor sees the divergence.
    await markFailed({
      externalContextId,
      orgId,
      errorClass: 'MissingAudioFileKey',
      attempt: job.attemptsMade + 1,
      source: row.source,
    });
    throw new Error(
      `external-ctx ${externalContextId}: audioFileKey missing on PENDING_TRANSCRIPTION row`,
    );
  }

  try {
    const audio = await getAudioBytes(row.audioFileKey);
    const raw = await transcribeBatch({
      // Reuse the worker's noteId convention — the SonioxService uses the
      // string only for client_reference_id (PHI-free), so passing the
      // external-context id is fine.
      noteId: externalContextId,
      audio,
      contentType: 'audio/wav',
    });
    const cleaned = cleanBatchTranscript(raw);

    await prisma.externalContext.update({
      where: { id: externalContextId },
      data: {
        status: ExternalContextStatus.READY,
        transcriptClean: cleaned.plaintext,
        transcriptRaw: raw as unknown as Prisma.InputJsonValue,
      },
    });

    await writeAuditLog({
      orgId,
      action: 'EXTERNAL_CONTEXT_TRANSCRIPTION_COMPLETED',
      resourceType: 'ExternalContext',
      resourceId: externalContextId,
      metadata: {
        durationMs: Date.now() - startedAt,
        wordCount: cleaned.wordCount,
        speakerCount: cleaned.speakerCount,
        source: row.source,
        stub: sonioxConfig.isStubMode,
        requestId,
      },
    });

    return { ok: true, externalContextId };
  } catch (err) {
    const errorClass = err instanceof Error ? err.name : 'Unknown';
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts?.attempts ?? 3;
    const isFinalAttempt = attempt >= maxAttempts;

    if (isFinalAttempt) {
      await markFailed({
        externalContextId,
        orgId,
        errorClass,
        attempt,
        source: row.source,
      });
    }
    // Rethrow either way so BullMQ records the failure / retries appropriately.
    throw err;
  }
}

async function markFailed(args: {
  externalContextId: string;
  orgId: string;
  errorClass: string;
  attempt: number;
  source: string;
}): Promise<void> {
  await prisma.externalContext.update({
    where: { id: args.externalContextId },
    data: { status: ExternalContextStatus.FAILED },
  });
  await writeAuditLog({
    orgId: args.orgId,
    action: 'EXTERNAL_CONTEXT_TRANSCRIPTION_FAILED',
    resourceType: 'ExternalContext',
    resourceId: args.externalContextId,
    metadata: {
      errorClass: args.errorClass,
      attempt: args.attempt,
      source: args.source,
    },
  });
}
