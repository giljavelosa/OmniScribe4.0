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
  externalContextTranscription: 'external-context-transcription',
  /** Sprint 0.13 — Miss Cleo's case-router agent. Chained from the
   *  ai-generation worker on completion. Same retry/backoff defaults as
   *  other queues (3 attempts, exponential 5s base — anti-regression rule 10). */
  caseRouter: 'case-router',
  /** Sprint 0.14 — Miss Cleo's per-(patient × clinician) state-projection
   *  worker. Chained from ai-generation completion, NOTE_SIGNED, and
   *  CASE_ROUTER_ACCEPTED. Throttled per-tuple (5 min) via the stable
   *  jobId; same retry semantics as other queues (rule 10). */
  cleoState: 'cleo-state',
  /** Sprint 0.17 — FHIR Phase D₃ write-back worker. Enqueued by
   *  `POST /api/cases/[id]/writeback/approve` after the clinician
   *  confirms the inline review-panel dialog. Idempotent on
   *  proposalId. Conservative concurrency (2) because EHR write QPS
   *  is vendor-gated. Standard rule-10 retry semantics — but ONLY
   *  TRANSIENT failures throw inside the handler (PERMANENT +
   *  CONFLICT fail-closed by design — decision 7). */
  fhirWriteback: 'fhir-writeback',
} as const;

export const transcriptionQueue = new Queue(QUEUE_NAMES.transcription, defaultOptions);
export const aiGenerationQueue = new Queue(QUEUE_NAMES.aiGeneration, defaultOptions);
export const noteFinalizeQueue = new Queue(QUEUE_NAMES.noteFinalize, defaultOptions);
export const voiceIdQueue = new Queue(QUEUE_NAMES.voiceId, voiceIdOptions);
export const noteBriefQueue = new Queue(QUEUE_NAMES.noteBrief, defaultOptions);
export const postSignArtifactsQueue = new Queue(QUEUE_NAMES.postSignArtifacts, defaultOptions);
export const externalContextTranscriptionQueue = new Queue(
  QUEUE_NAMES.externalContextTranscription,
  defaultOptions,
);
export const caseRouterQueue = new Queue(QUEUE_NAMES.caseRouter, defaultOptions);
export const cleoStateQueue = new Queue(QUEUE_NAMES.cleoState, defaultOptions);
export const fhirWritebackQueue = new Queue(QUEUE_NAMES.fhirWriteback, defaultOptions);

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

/**
 * External-context transcription — enqueued by the upload-mode POST after the
 * audio bytes land in S3. Stable jobId follows the 3-part rule:
 *   `external-ctx:{externalContextId}:{requestId}`
 * so a retried POST collapses to the same Redis entry.
 */
export function enqueueExternalContextTranscriptionJob(payload: {
  externalContextId: string;
  orgId: string;
  requestId: string;
}) {
  return externalContextTranscriptionQueue.add('transcribe-external-context', payload, {
    jobId: `external-ctx:${payload.externalContextId}:${payload.requestId}`,
  });
}

/**
 * Sprint 0.13 — chain-enqueued by the ai-generation worker on completion.
 * Idempotent on noteId (stable jobId); a retried enqueue collapses to one
 * Redis entry. Same retry semantics as other queues (rule 10).
 */
export function enqueueCaseRouterJob(payload: { noteId: string; orgId: string }) {
  return caseRouterQueue.add('propose-case-routing', payload, {
    jobId: `case-router:${payload.noteId}`,
  });
}

/**
 * Sprint 0.14 — chain-enqueued from ai-generation completion, NOTE_SIGNED,
 * and CASE_ROUTER_ACCEPTED.
 *
 * Throttle: stable jobId per (org × patient × clinician × 5-minute bucket).
 * BullMQ rejects duplicate jobIds silently (returns the existing job), so
 * multiple events arriving inside one 5-min window coalesce to one rebuild.
 * Honors the spec's "at most one rebuild per (patient × clinician) per
 * 5 minutes" requirement without an extra mutex.
 */
export function enqueueCleoStateRefresh(payload: {
  orgId: string;
  patientId: string;
  clinicianOrgUserId: string;
}) {
  const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
  const jobId = `cleo-state:${payload.orgId}:${payload.patientId}:${payload.clinicianOrgUserId}:${bucket}`;
  return cleoStateQueue.add('refresh-cleo-state', payload, { jobId });
}

/**
 * Sprint 0.17 — chain-enqueued by `POST /api/cases/[id]/writeback/approve`
 * (and `/retry`).
 *
 * Idempotent on `proposalId` — a duplicate enqueue (e.g. retried API
 * request) collapses to the same Redis entry. This + the unique
 * `idempotencyKey` column on `FhirWriteBackProposal` means we never
 * double-write to the EHR even under worker retry (decision 2).
 *
 * Same rule-10 retry semantics as other queues (3 attempts, exponential
 * 5s base). The handler itself only throws on TRANSIENT failures —
 * PERMANENT + CONFLICT are recorded and the job completes without a
 * retry attempt (decision 7).
 */
export function enqueueFhirWriteback(payload: { proposalId: string }) {
  return fhirWritebackQueue.add('writeback', payload, {
    jobId: `writeback:${payload.proposalId}`,
  });
}
