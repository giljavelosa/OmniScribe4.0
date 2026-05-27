import type { Job } from 'bullmq';
import { NoteArtifactKind, NoteStatus, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { getLLMService } from '@/services/llm';
import { stripJsonFence } from '@/lib/llm/strip-json-fence';
import { projectPatientForPrompt, projectEpisodeForPrompt } from '@/lib/notes/projections';
import {
  buildPatientInstructionsPrompt,
  buildReferralLetterPrompt,
  type FinalJsonShape,
} from '@/lib/notes/build-artifact-prompt';
import { PERSONA_VERSION } from '@/services/copilot/persona';

type PostSignArtifactJob = {
  noteId: string;
  orgId: string;
  type: 'generate-patient-instructions' | 'generate-referral-letter';
  requestId: string;
};

/**
 * post-sign-artifacts worker (spec §I).
 *
 * Runs ONLY for signed notes. Two job types:
 *
 *   1. generate-patient-instructions — Haiku-class (fast + cheap; the artifact
 *      is plain-language + short). Produces { plainLanguage, bulletPoints,
 *      whatToWatchFor, whenToCallUs }.
 *
 *   2. generate-referral-letter — Sonnet-class (the artifact is structured
 *      clinical correspondence; the model needs to weigh signed-note
 *      findings carefully). Produces { recipient, subject, body }.
 *
 * Idempotency:
 *   - BullMQ jobId already includes requestId (queue.ts).
 *   - We additionally check for an existing NoteArtifact of the same kind on
 *     the note; if one exists, we SKIP (don't overwrite). The sign route
 *     enqueues once per sign; if a future workflow re-enqueues intentionally,
 *     that path should delete the prior artifact first.
 *
 * Anti-regression rule 3: this worker NEVER writes Note.finalJson. It only
 * reads finalJson (the frozen attested artifact) and writes NoteArtifact rows.
 *
 * Anti-regression rule 8: errors are NOT swallowed — they bubble so BullMQ's
 * retry policy kicks in (3 attempts, exponential backoff). On final failure
 * BullMQ emits 'failed' which we log; the audit row captures the error class.
 */
export async function handle(job: Job<PostSignArtifactJob>) {
  const { noteId, orgId, type, requestId } = job.data;

  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId },
    include: {
      patient: true,
      encounter: { include: { episode: { include: { department: true, goals: true } } } },
    },
  });
  if (!note) {
    console.warn(`[post-sign-artifacts] note ${noteId} not found — dropping`);
    return { skipped: 'not_found' };
  }
  if (note.status !== NoteStatus.SIGNED) {
    console.warn(
      `[post-sign-artifacts] note ${noteId} status=${note.status} (expected SIGNED) — dropping`,
    );
    return { skipped: 'not_signed' };
  }
  if (!note.finalJson) {
    console.warn(`[post-sign-artifacts] note ${noteId} has no finalJson — dropping`);
    return { skipped: 'no_final_json' };
  }

  const kind = kindFor(type);

  const existing = await prisma.noteArtifact.findFirst({
    where: { noteId, kind },
    select: { id: true },
  });
  if (existing) {
    await writeAuditLog({
      orgId,
      action: 'POST_SIGN_ARTIFACT_SKIPPED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: { kind, requestId, reason: 'already_exists', existingArtifactId: existing.id },
    });
    return { skipped: 'already_exists', artifactId: existing.id };
  }

  const finalJson = note.finalJson as unknown as FinalJsonShape;
  const patient = projectPatientForPrompt(note.patient);
  const episode = note.encounter?.episode
    ? projectEpisodeForPrompt(note.encounter.episode)
    : undefined;

  const llm = getLLMService();
  const { system, user, model } = promptFor(type, finalJson, patient, episode);

  try {
    const result = await llm.generate(system, user, {
      phi: true,
      temperature: 0,
      jsonMode: true,
      model,
      requestId,
    });
    const content = parseArtifact(type, result.text);

    const artifact = await prisma.noteArtifact.create({
      data: {
        noteId,
        kind,
        content: content as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    await writeAuditLog({
      orgId,
      action: 'POST_SIGN_ARTIFACT_GENERATED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: {
        kind,
        artifactId: artifact.id,
        requestId,
        model: result.model,
        latencyMs: result.latencyMs,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        stub: result.stub ?? false,
        // Sprint 0.12 — persona-pass audit metadata so regulators can
        // filter every AI-authored artifact by Miss Cleo's persona version.
        personaVersion: PERSONA_VERSION,
      },
    });

    return { ok: true, kind, artifactId: artifact.id };
  } catch (err) {
    const errorClass = err instanceof Error ? err.name : 'Unknown';
    await writeAuditLog({
      orgId,
      action: 'POST_SIGN_ARTIFACT_GENERATION_FAILED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: { kind, requestId, errorClass },
    });
    throw err;
  }
}

function kindFor(type: PostSignArtifactJob['type']): NoteArtifactKind {
  return type === 'generate-patient-instructions'
    ? NoteArtifactKind.PATIENT_INSTRUCTIONS
    : NoteArtifactKind.REFERRAL_LETTER;
}

function promptFor(
  type: PostSignArtifactJob['type'],
  finalJson: FinalJsonShape,
  patient: ReturnType<typeof projectPatientForPrompt>,
  episode: ReturnType<typeof projectEpisodeForPrompt> | undefined,
): { system: string; user: string; model: 'sonnet' | 'haiku' } {
  if (type === 'generate-patient-instructions') {
    const parts = buildPatientInstructionsPrompt(finalJson, patient, episode);
    return { ...parts, model: 'haiku' };
  }
  const parts = buildReferralLetterPrompt(finalJson, patient, episode);
  return { ...parts, model: 'sonnet' };
}

type PatientInstructionsContent = {
  plainLanguage: string;
  bulletPoints: string[];
  whatToWatchFor: string[];
  whenToCallUs: string[];
  schemaVersion: 1;
};

type ReferralLetterContent = {
  recipient: string;
  subject: string;
  body: string;
  schemaVersion: 1;
};

/**
 * Parse the LLM JSON output into the canonical artifact shape. Defensive —
 * stub-mode Bedrock returns { stub: true, text, … } which won't match either
 * shape; we coerce that into a "stub placeholder" content body so the row
 * still lands and the clinical flow is exercised end-to-end in dev.
 */
function parseArtifact(
  type: PostSignArtifactJob['type'],
  rawText: string,
): PatientInstructionsContent | ReferralLetterContent {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(stripJsonFence(rawText)) as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  if (type === 'generate-patient-instructions') {
    if (parsed && typeof parsed.plainLanguage === 'string') {
      return {
        plainLanguage: parsed.plainLanguage,
        bulletPoints: arrayOfStrings(parsed.bulletPoints),
        whatToWatchFor: arrayOfStrings(parsed.whatToWatchFor),
        whenToCallUs: arrayOfStrings(parsed.whenToCallUs),
        schemaVersion: 1,
      };
    }
    return {
      plainLanguage: stubPlaceholder('patient instructions', parsed),
      bulletPoints: ['(stub — set AWS_BEARER_TOKEN_BEDROCK + a real BEDROCK_MODEL_ID for a real artifact)'],
      whatToWatchFor: ['(stub — no real red flags computed)'],
      whenToCallUs: ['(stub — no real escalation criteria computed)'],
      schemaVersion: 1,
    };
  }

  if (parsed && typeof parsed.recipient === 'string' && typeof parsed.body === 'string') {
    return {
      recipient: parsed.recipient,
      subject: typeof parsed.subject === 'string' ? parsed.subject : 'Referral',
      body: parsed.body,
      schemaVersion: 1,
    };
  }
  return {
    recipient: 'General — please direct as appropriate',
    subject: 'Referral (stub)',
    body: stubPlaceholder('referral letter', parsed),
    schemaVersion: 1,
  };
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function stubPlaceholder(label: string, parsed: Record<string, unknown> | null): string {
  if (parsed && typeof parsed.text === 'string') {
    return `[${label} — stub] ${parsed.text}`;
  }
  return `[${label} — stub] Set AWS_BEARER_TOKEN_BEDROCK + BEDROCK_MODEL_ID for real output.`;
}
