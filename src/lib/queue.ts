import { Queue, type QueueOptions } from 'bullmq';
import { redis } from './redis';

/**
 * BullMQ queue registry + enqueue helpers (spec §A).
 *
 * Defaults per anti-regression rule 10:
 *   - attempts: 3 (voice-id: 2 — best-effort, never blocks downstream)
 *   - backoff : exponential, 5s base (5s / 10s / 20s)
 *   - removeOnComplete: 100, removeOnFail: 1000
 *
 * Idempotency: every enqueue helper computes a stable jobId from the
 * payload so a duplicate enqueue (e.g. retried API request) collapses to
 * the same Redis entry.
 */

const defaultOptions: QueueOptions = {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 1000 },
  },
};

const voiceIdOptions: QueueOptions = {
  connection: redis,
  defaultJobOptions: {
    ...defaultOptions.defaultJobOptions,
    attempts: 2,
  },
};

export const QUEUE_NAMES = {
  transcription: 'transcription',
  aiGeneration: 'ai-generation',
  noteFinalize: 'note-finalize',
  voiceId: 'voice-id',
  noteBrief: 'note-brief',
  postSignArtifacts: 'post-sign-artifacts',
} as const;

export const transcriptionQueue = new Queue(QUEUE_NAMES.transcription, defaultOptions);
export const aiGenerationQueue = new Queue(QUEUE_NAMES.aiGeneration, defaultOptions);
export const noteFinalizeQueue = new Queue(QUEUE_NAMES.noteFinalize, defaultOptions);
export const voiceIdQueue = new Queue(QUEUE_NAMES.voiceId, voiceIdOptions);
export const noteBriefQueue = new Queue(QUEUE_NAMES.noteBrief, defaultOptions);
export const postSignArtifactsQueue = new Queue(QUEUE_NAMES.postSignArtifacts, defaultOptions);

// ---------------------------------------------------------------------------
// Enqueue helpers — keep the call sites typed + idempotent.
// ---------------------------------------------------------------------------

export type TranscriptionJobType = 'finalize-realtime-transcript' | 'transcribe-uploaded-audio' | 'cleanup-pasted-transcript';

export function enqueueTranscriptionJob(payload: {
  noteId: string;
  orgId: string;
  type: TranscriptionJobType;
  requestId: string;
}) {
  return transcriptionQueue.add(payload.type, payload, {
    jobId: `transcription:${payload.noteId}:${payload.requestId}`,
  });
}

export type AiGenerationJobType = 'generate-note' | 'regenerate-section' | 'analyze-flags';

export function enqueueAiGenerationJob(payload: {
  noteId: string;
  orgId: string;
  type: AiGenerationJobType;
  requestId: string;
  sectionId?: string;
}) {
  const id = payload.sectionId
    ? `ai-generation:${payload.noteId}:${payload.sectionId}:${payload.requestId}`
    : `ai-generation:${payload.noteId}:${payload.requestId}`;
  return aiGenerationQueue.add(payload.type, payload, { jobId: id });
}

export function enqueueNoteFinalizeJob(payload: { noteId: string; orgId: string; requestId: string }) {
  return noteFinalizeQueue.add('finalize-note', payload, {
    jobId: `note-finalize:${payload.noteId}:${payload.requestId}`,
  });
}

export type VoiceIdJobType = 'match-speakers' | 'compute-enrollment-embedding';

export function enqueueVoiceIdJob(payload: {
  noteId: string;
  orgId: string;
  type?: VoiceIdJobType;
  requestId: string;
}) {
  const type = payload.type ?? 'match-speakers';
  return voiceIdQueue.add(type, { ...payload, type }, {
    jobId: `voice-id:${payload.noteId}:${type}:${payload.requestId}`,
  });
}

export function enqueueNoteBriefJob(payload: { noteId: string; orgId: string }) {
  // Idempotent on noteId — only one brief per signed note (spec rule).
  return noteBriefQueue.add('precompute-brief', payload, {
    jobId: `note-brief:${payload.noteId}`,
  });
}

export type PostSignArtifactJobType = 'generate-patient-instructions' | 'generate-referral-letter';

export function enqueuePostSignArtifactJob(payload: {
  noteId: string;
  orgId: string;
  type: PostSignArtifactJobType;
  requestId: string;
}) {
  return postSignArtifactsQueue.add(payload.type, payload, {
    jobId: `post-sign:${payload.noteId}:${payload.type}:${payload.requestId}`,
  });
}
