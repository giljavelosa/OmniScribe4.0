import type { Job } from 'bullmq';
import { Prisma, NoteStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { getAudioBytes } from '@/lib/s3/client';
import { computeEmbedding, cosineSimilarity, titanetConfig } from '@/services/voice-id/titanet';
import type { TranscriptClean, SpeakerRole } from '@/services/transcription';

type VoiceIdJobData = {
  noteId: string;
  orgId: string;
  type?: 'match-speakers' | 'compute-enrollment-embedding';
  requestId: string;
};

/** Cosine threshold above which we assign a speaker to an enrolled profile. */
const MATCH_THRESHOLD = 0.72;

/**
 * Voice-ID worker (Sprint A, W0-01).
 *
 * Two job types:
 *
 *   match-speakers — run after every transcription job. Fetches enrolled
 *     VoiceProfiles for the org, computes per-utterance embeddings from the
 *     note audio, cosine-matches to each profile, and rewrites
 *     Note.transcriptClean.structured[].speaker from numeric (CLINICIAN/OTHER)
 *     to role-labeled values. Best-effort: never blocks ai-generation.
 *
 *   compute-enrollment-embedding — triggered after a new enrollment audio is
 *     uploaded. Calls TitaNet, stores the 192-dim vector in VoiceProfile.embedding.
 *
 * In TitaNet stub mode (TITANET_ENDPOINT unset): embeddings are synthetic
 * but deterministic, so the pipeline exercises end-to-end in local dev.
 * The audit row notes stub: true so production logs aren't confused.
 *
 * Rule 11 analogue: this is the SOLE importer of TitaNet — never import
 * titanet.ts from app routes or other workers.
 */
export async function handle(job: Job<VoiceIdJobData>) {
  const { noteId, orgId, type = 'match-speakers' } = job.data;

  if (type === 'compute-enrollment-embedding') {
    return handleEnrollmentEmbedding(job.data);
  }

  return handleMatchSpeakers(noteId, orgId);
}

// ---------------------------------------------------------------------------
// match-speakers — post-transcription speaker labeling.
// ---------------------------------------------------------------------------

async function handleMatchSpeakers(noteId: string, orgId: string) {
  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId },
    select: {
      id: true,
      status: true,
      transcriptClean: true,
      audioFileKey: true,
      audioSegments: {
        where: { isDeleted: false },
        orderBy: { segmentIndex: 'asc' },
        take: 1,
        select: { s3Key: true, mimeType: true },
      },
    },
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

  // Load enrolled profiles for the org.
  // embeddings are stored as an opaque string from Postgres; parse them.
  const profiles = await prisma.$queryRaw<Array<{
    id: string;
    orgUserId: string;
    defaultRole: string;
    embedding: string | null;
  }>>`
    SELECT id, "orgUserId", "defaultRole", embedding::text
    FROM "VoiceProfile"
    WHERE "orgId" = ${orgId}
      AND "isDeleted" = false
      AND embedding IS NOT NULL
  `;

  if (profiles.length === 0) {
    await writeAuditLog({
      orgId,
      action: 'VOICE_ID_SKIPPED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: { reason: 'no_enrolled_profiles', stub: titanetConfig.isStubMode },
    });
    return { skipped: 'no_enrolled_profiles' };
  }

  // Without audio we can't compute per-utterance embeddings.
  const audioKey = note.audioSegments[0]?.s3Key ?? note.audioFileKey;
  if (!audioKey) {
    await writeAuditLog({
      orgId,
      action: 'VOICE_ID_SKIPPED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: { reason: 'no_audio_file' },
    });
    return { skipped: 'no_audio_file' };
  }

  let audio: Buffer;
  try {
    audio = await getAudioBytes(audioKey);
  } catch {
    await writeAuditLog({
      orgId,
      action: 'VOICE_ID_SKIPPED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: { reason: 'audio_fetch_failed' },
    });
    return { skipped: 'audio_fetch_failed' };
  }

  // Parse stored embeddings from Postgres vector string format "[0.1, 0.2, ...]".
  const parsedProfiles = profiles.map((p) => ({
    ...p,
    vec: parseVectorString(p.embedding),
  })).filter((p) => p.vec.length > 0);

  if (parsedProfiles.length === 0) {
    await writeAuditLog({
      orgId,
      action: 'VOICE_ID_SKIPPED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: { reason: 'embeddings_unparseable' },
    });
    return { skipped: 'embeddings_unparseable' };
  }

  // Build per-speaker-number embedding from the note audio.
  // In production, we'd window the audio per speaker timestamps; in v1 we use
  // the full audio for a single "who is the dominant speaker" match.
  let noteEmbedding: number[];
  let embeddingStub = false;
  try {
    const mimeType = note.audioSegments[0]?.mimeType ?? 'audio/wav';
    const result = await computeEmbedding(audio, mimeType);
    noteEmbedding = result.embedding;
    embeddingStub = result.stub;
  } catch (err) {
    await writeAuditLog({
      orgId,
      action: 'VOICE_ID_SKIPPED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: { reason: 'embedding_failed', stub: titanetConfig.isStubMode },
    });
    console.warn('[voice-id] embedding failed:', err instanceof Error ? err.message : String(err));
    return { skipped: 'embedding_failed' };
  }

  // Find the best matching profile.
  let bestProfile: typeof parsedProfiles[number] | null = null;
  let bestScore = 0;
  for (const p of parsedProfiles) {
    const score = cosineSimilarity(noteEmbedding, p.vec);
    if (score > bestScore) { bestScore = score; bestProfile = p; }
  }

  const matched = bestProfile !== null && bestScore >= MATCH_THRESHOLD;

  if (!matched) {
    await writeAuditLog({
      orgId,
      action: 'VOICE_ID_SKIPPED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: { reason: 'no_match_above_threshold', bestScore: Math.round(bestScore * 1000) / 1000, stub: embeddingStub },
    });
    return { skipped: 'no_match_above_threshold', bestScore };
  }

  // Relabel speaker 1 → bestProfile.defaultRole (usually CLINICIAN),
  // all others → PATIENT (crude but correct for 2-speaker visits).
  const speakerCount = new Set(clean.structured.map((s) => s.originalSpeaker)).size;
  const dominantSpeaker = 1; // Soniox speaker 1 is always first-heard
  const updatedStructured = clean.structured.map((seg) => ({
    ...seg,
    speaker: seg.originalSpeaker === dominantSpeaker
      ? (bestProfile!.defaultRole as SpeakerRole)
      : ('PATIENT' as SpeakerRole),
  }));

  const updatedClean: TranscriptClean = { ...clean, structured: updatedStructured };

  // Write updated transcript and audit — do NOT flip Note.status (voice-id
  // runs after DRAFTING is already triggered; the status may have advanced).
  await prisma.note.update({
    where: { id: noteId },
    data: { transcriptClean: updatedClean as unknown as Prisma.InputJsonValue },
  });

  await writeAuditLog({
    orgId,
    action: 'VOICE_ID_MATCHED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: {
      profileId: bestProfile!.id,
      score: Math.round(bestScore * 1000) / 1000,
      speakerCount,
      stub: embeddingStub,
    },
  });

  return { ok: true, matched: true, score: bestScore, stub: embeddingStub };
}

// ---------------------------------------------------------------------------
// compute-enrollment-embedding — triggered by the enrollment API.
// ---------------------------------------------------------------------------

async function handleEnrollmentEmbedding(data: VoiceIdJobData) {
  const { noteId: profileId, orgId } = data; // noteId field reused as profileId

  const profile = await prisma.voiceProfile.findFirst({
    where: { id: profileId, orgId, isDeleted: false },
    select: { id: true, enrollmentS3Key: true },
  });

  if (!profile?.enrollmentS3Key) {
    await writeAuditLog({
      orgId,
      action: 'VOICE_ID_SKIPPED',
      resourceType: 'Note', // resourceType reused; profileId stored in resourceId
      resourceId: profileId,
      metadata: { reason: 'no_enrollment_audio' },
    });
    return { skipped: 'no_enrollment_audio' };
  }

  const audio = await getAudioBytes(profile.enrollmentS3Key);
  const { embedding, stub } = await computeEmbedding(audio, 'audio/wav');

  // Store as pgvector literal string: "[0.1,0.2,...]"
  const vectorLiteral = `[${embedding.join(',')}]`;

  await prisma.$executeRaw`
    UPDATE "VoiceProfile"
    SET embedding = ${vectorLiteral}::vector, "updatedAt" = NOW()
    WHERE id = ${profileId}
  `;

  await writeAuditLog({
    orgId,
    action: 'VOICE_ID_ENROLLED',
    resourceType: 'Note',
    resourceId: profileId,
    metadata: { dim: embedding.length, stub },
  });

  return { ok: true, stub };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseVectorString(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const trimmed = raw.replace(/^\[/, '').replace(/\]$/, '');
    return trimmed.split(',').map(Number).filter((n) => !Number.isNaN(n));
  } catch {
    return [];
  }
}
