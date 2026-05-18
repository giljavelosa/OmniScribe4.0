import type { Job } from 'bullmq';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import type { TranscriptClean } from '@/services/transcription';

type VoiceIdJobData = {
  noteId: string;
  orgId: string;
  type?: 'match-speakers' | 'compute-enrollment-embedding';
  requestId: string;
};

/**
 * Voice-id worker (spec §E) — SKELETON for Unit 04.
 *
 * Real implementation requires:
 *   - VoiceProfile model with embedding vector(192) (pgvector)
 *   - TitaNet service for x-vector embeddings
 *   - S3 audio windowing per speaker
 * None of which exists in the kit yet. This skeleton:
 *   - validates the note + transcript exist
 *   - audits VOICE_ID_SKIPPED with the reason
 *   - returns success (never blocks ai-generation per spec)
 *
 * When TitaNet + VoiceProfile land in a future unit, replace with the real
 * match-speakers / compute-enrollment-embedding logic. Job-data contract is
 * already in place.
 */
export async function handle(job: Job<VoiceIdJobData>) {
  const { noteId, orgId } = job.data;
  try {
    const note = await prisma.note.findFirst({
      where: { id: noteId, orgId },
      select: { id: true, transcriptClean: true },
    });
    if (!note?.transcriptClean) {
      await writeAuditLog({
        orgId,
        action: 'VOICE_ID_SKIPPED',
        resourceType: 'Note',
        resourceId: noteId,
        metadata: { reason: 'no_transcript' },
      });
      return { skipped: 'no_transcript' };
    }

    const clean = note.transcriptClean as unknown as TranscriptClean;
    const speakerCount = new Set(clean.structured.map((s) => s.originalSpeaker)).size;

    await writeAuditLog({
      orgId,
      action: 'VOICE_ID_SKIPPED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: {
        reason: 'voice_profile_not_yet_implemented',
        speakerCount,
        segmentCount: clean.structured.length,
      },
    });
    return { skipped: 'voice_profile_not_implemented', speakerCount };
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.warn('[voice-id] failed:', message);
    try {
      await writeAuditLog({
        orgId,
        action: 'VOICE_ID_FAILED',
        resourceType: 'Note',
        resourceId: noteId,
        metadata: { errorClass: err instanceof Error ? err.name : 'Unknown' },
      });
    } catch {
      // best-effort; voice-id is decorative per spec
    }
    return { failed: true };
  }
}
