import type { Job } from 'bullmq';
import { Prisma, NoteStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import {
  cleanRealtimeTranscript,
  cleanBatchTranscript,
  transcribeBatch,
  type TranscriptClean,
} from '@/services/transcription';
import { enqueueAiGenerationJob, enqueueVoiceIdJob } from '@/lib/queue';
import { getAudioBytes } from '@/lib/s3/client';
import { randomBytes } from 'node:crypto';

type TranscriptionJobData = {
  noteId: string;
  orgId: string;
  type: 'finalize-realtime-transcript' | 'transcribe-uploaded-audio' | 'cleanup-pasted-transcript';
  requestId: string;
};

/**
 * Transcription worker (spec §C).
 *
 * Idempotent guard: skip if the note has already advanced past TRANSCRIBING.
 * Re-runs are safe — at-most-once-per-stable-jobId via queue.ts.
 *
 * Three branches by job.data.type:
 *   1. finalize-realtime-transcript — Note.transcriptRaw was written by
 *      /complete-stream. Clean via cleanRealtimeTranscript.
 *   2. transcribe-uploaded-audio    — Audio in S3 (Note.audioFileKey). Fetch
 *      + Soniox batch + write transcriptRaw + clean via cleanBatchTranscript.
 *   3. cleanup-pasted-transcript    — /paste-transcript already wrote
 *      Note.transcriptClean. Pass-through; advance to DRAFTING.
 *
 * On success: writes transcriptClean, flips TRANSCRIBING → DRAFTING, enqueues
 * ai-generation (Unit 05 stub for now) + voice-id (skeleton).
 *
 * On unrecoverable failure (final BullMQ attempt): mark Note INTERRUPTED +
 * lastWorkerError + interruptedAt; audit NOTE_INTERRUPTED so /processing
 * (Unit 05) can surface "we'll retry" + a manual retry button (spec §H).
 */
export async function handle(job: Job<TranscriptionJobData>) {
  const { noteId, orgId, type, requestId } = job.data;

  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId },
    select: {
      id: true,
      status: true,
      captureMode: true,
      transcriptRaw: true,
      transcriptClean: true,
      audioFileKey: true,
    },
  });
  if (!note) {
    console.warn(`[transcription] note ${noteId} not found — dropping job`);
    return { skipped: 'not_found' };
  }
  if (note.status !== NoteStatus.TRANSCRIBING) {
    return { skipped: `status=${note.status}` };
  }

  let cleaned: TranscriptClean | null = null;

  try {
    if (type === 'finalize-realtime-transcript') {
      if (!note.transcriptRaw) {
        throw new Error('finalize-realtime-transcript: transcriptRaw missing');
      }
      cleaned = cleanRealtimeTranscript(
        note.transcriptRaw as unknown as Parameters<typeof cleanRealtimeTranscript>[0],
      );
    } else if (type === 'transcribe-uploaded-audio') {
      if (!note.audioFileKey) throw new Error('transcribe-uploaded-audio: audioFileKey missing');
      const audio = await getAudioBytes(note.audioFileKey);
      const raw = await transcribeBatch({
        audio,
        contentType: 'audio/wav',
        noteId,
      });
      await prisma.note.update({
        where: { id: noteId },
        data: { transcriptRaw: raw as unknown as Prisma.InputJsonValue },
      });
      cleaned = cleanBatchTranscript(raw);
    } else if (type === 'cleanup-pasted-transcript') {
      if (!note.transcriptClean) {
        throw new Error('cleanup-pasted-transcript: transcriptClean missing');
      }
      cleaned = note.transcriptClean as unknown as TranscriptClean;
    } else {
      throw new Error(`unknown transcription job type: ${type as string}`);
    }
  } catch (err) {
    const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 3);
    if (isFinalAttempt) {
      await markInterrupted(noteId, orgId, err);
    }
    throw err;
  }

  await prisma.note.update({
    where: { id: noteId },
    data: {
      transcriptClean: cleaned as unknown as Prisma.InputJsonValue,
      status: NoteStatus.DRAFTING,
    },
  });

  await writeAuditLog({
    orgId,
    action: 'TRANSCRIPT_FINALIZED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: {
      type,
      source: cleaned.source,
      wordCount: cleaned.wordCount,
      speakerCount: cleaned.speakerCount,
      durationMs: cleaned.durationMs,
      segmentCount: cleaned.structured.length,
    },
  });
  await writeAuditLog({
    orgId,
    action: 'NOTE_STATUS_TRANSITIONED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: { from: 'TRANSCRIBING', to: 'DRAFTING', via: 'transcription-worker' },
  });

  await enqueueAiGenerationJob({
    noteId,
    orgId,
    type: 'generate-note',
    requestId: childRequestId(requestId, 'ai-gen'),
  });
  await enqueueVoiceIdJob({
    noteId,
    orgId,
    requestId: childRequestId(requestId, 'voice-id'),
  });

  return { ok: true, status: 'DRAFTING', stats: { wordCount: cleaned.wordCount, speakerCount: cleaned.speakerCount } };
}

async function markInterrupted(noteId: string, orgId: string, err: unknown) {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  await prisma.note.update({
    where: { id: noteId },
    data: {
      status: NoteStatus.INTERRUPTED,
      interruptedAt: new Date(),
      lastWorkerError: message.slice(0, 500),
    },
  });
  await writeAuditLog({
    orgId,
    action: 'NOTE_INTERRUPTED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: { worker: 'transcription', errorClass: err instanceof Error ? err.name : 'Unknown' },
  });
}

function childRequestId(parent: string, child: string): string {
  return `${parent}-${child}-${randomBytes(4).toString('hex')}`;
}
