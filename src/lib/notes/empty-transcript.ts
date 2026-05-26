/**
 * Empty-transcript detection + lifecycle helpers.
 *
 * Background
 * ----------
 * When `/api/notes/[id]/complete-stream` accepts a finalize that contains
 * audio but no recognized speech (mic muted, silence, dead Soniox stream),
 * the cleaned transcript ends up at `wordCount === 0`. The AI generation
 * worker has a deliberate "rule 1 attestation guard" that refuses to
 * fabricate clinical content from no source material — so it writes the
 * same "No transcript captured…" placeholder into every template section
 * and transitions the note to DRAFT.
 *
 * Without an explicit signal, /review has no idea this is the empty path
 * vs. a real draft, so the clinician sees six identical paragraphs and
 * concludes the system is broken.
 *
 * This helper:
 *   - centralizes the "is this transcript usable?" predicate so the
 *     worker, the /complete-stream pre-check, and any future surfaces
 *     all agree on the same threshold.
 *   - persists the empty-transcript signal into Note.inferenceLog._meta
 *     so server components on /review can render an explicit banner +
 *     re-record CTA without re-deriving the placeholder text.
 *   - exposes a read helper so the review surface doesn't have to walk
 *     the InferenceLog shape directly.
 *
 * PHI-free at every layer: only durations, byte sizes, and a boolean.
 */

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

import type { TranscriptClean } from '@/services/transcription';
import {
  readInferenceLog,
  type InferenceLog,
  type InferenceMeta,
} from '@/lib/notes/section-status';

/**
 * Pure predicate: returns true when the cleaned transcript has nothing
 * the LLM can ground on. Identical to the `hasUsableTranscript`
 * inversion the worker uses; centralized here so callers don't drift.
 */
export function isEmptyTranscript(transcriptClean: TranscriptClean | null): boolean {
  if (!transcriptClean) return true;
  return (transcriptClean.wordCount ?? 0) === 0;
}

/**
 * Read helper for /review + any surface that needs to know whether a
 * draft was generated from an empty transcript. Returns the meta block
 * (with durationMs / byteSize) when set, otherwise null.
 */
export function readEmptyTranscriptMeta(inferenceLog: unknown): {
  durationMs: number;
  byteSize: number;
  detectedAt: string | null;
} | null {
  const log = readInferenceLog(inferenceLog);
  const meta = log._meta;
  if (!meta?.emptyTranscript) return null;
  return {
    durationMs: meta.emptyTranscriptDurationMs ?? 0,
    byteSize: meta.emptyTranscriptByteSize ?? 0,
    detectedAt: meta.emptyTranscriptDetectedAt ?? null,
  };
}

/** First line of the per-section placeholder the worker writes when
 *  the transcript was empty. Used by the legacy-detection fallback
 *  so notes generated before the `_meta` signal landed still surface
 *  <EmptyTranscriptBanner>. Keep in sync with the worker. */
export const EMPTY_TRANSCRIPT_PLACEHOLDER_PREFIX = 'No transcript captured for this encounter.';

/**
 * Fallback detector for legacy notes that pre-date the explicit
 * `_meta.emptyTranscript` signal. Returns true when:
 *   - transcriptClean has 0 words (the original short-circuit gate), AND
 *   - draftJson is non-empty AND every populated section's content
 *     starts with the placeholder prefix.
 *
 * The "every populated section" check guards against false positives
 * on partially-written drafts where one section happens to mention
 * "No transcript captured" by coincidence.
 */
export function inferEmptyTranscriptFromDraft(args: {
  transcriptClean: TranscriptClean | null;
  draftJson: unknown;
}): boolean {
  if (!isEmptyTranscript(args.transcriptClean)) return false;
  const draft = args.draftJson as Record<string, { content?: string }> | null;
  if (!draft) return false;
  const entries = Object.values(draft).filter((s) => typeof s?.content === 'string');
  if (entries.length === 0) return false;
  return entries.every((s) =>
    (s.content ?? '').trim().startsWith(EMPTY_TRANSCRIPT_PLACEHOLDER_PREFIX),
  );
}

/**
 * Combined detector: prefers the explicit `_meta` signal (set by the
 * worker post-2026-05-26), falls back to the legacy heuristic for
 * notes that pre-date the signal. Returns the marker the
 * <EmptyTranscriptBanner> needs (durationMs + byteSize, both possibly
 * 0 for the legacy path since the original audit didn't capture them).
 *
 * Truthiness invariant
 * --------------------
 * The CURRENT transcript state always wins. If `transcriptClean` has
 * words, the note has real content — even if a stale
 * `_meta.emptyTranscript: true` is still on the row from a prior
 * generation pass that was later overridden (e.g. paste-transcript →
 * re-generate). Without this check the reset-recording route would
 * destroy a real recording on the strength of a stale marker.
 */
export function detectEmptyTranscript(args: {
  inferenceLog: unknown;
  transcriptClean: TranscriptClean | null;
  draftJson: unknown;
}): { durationMs: number; byteSize: number; detectedAt: string | null } | null {
  if (!isEmptyTranscript(args.transcriptClean)) return null;
  const explicit = readEmptyTranscriptMeta(args.inferenceLog);
  if (explicit) return explicit;
  if (
    inferEmptyTranscriptFromDraft({
      transcriptClean: args.transcriptClean,
      draftJson: args.draftJson,
    })
  ) {
    // Legacy path: marker fields fall back to 0 — banner copy is
    // still useful ("No audio reached the transcription pipeline…").
    return { durationMs: 0, byteSize: 0, detectedAt: null };
  }
  return null;
}

export type EmptyTranscriptMarker = {
  durationMs: number;
  byteSize: number;
};

/**
 * Worker-side writer. Called from the ai-generation handler's
 * empty-transcript short-circuit (right before status flips to DRAFT)
 * so /review can deterministically detect this case.
 *
 * Merge semantics: preserves any existing `_meta` keys (forward-
 * compatible if future signals land here) and overwrites only the
 * empty-transcript fields. Race-safe in the same way `markSectionStatus`
 * is — BullMQ runs the generate-note handler single-flight per jobId,
 * so there's no concurrent writer for this note's inferenceLog.
 */
export async function markNoteEmptyTranscript(
  noteId: string,
  marker: EmptyTranscriptMarker,
): Promise<void> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { inferenceLog: true },
  });
  if (!note) {
    throw new Error(`markNoteEmptyTranscript: note ${noteId} not found`);
  }
  const log = readInferenceLog(note.inferenceLog);
  const nextMeta: InferenceMeta = {
    ...(log._meta ?? {}),
    emptyTranscript: true,
    emptyTranscriptDurationMs: marker.durationMs,
    emptyTranscriptByteSize: marker.byteSize,
    emptyTranscriptDetectedAt: new Date().toISOString(),
  };
  const next: InferenceLog = { ...log, _meta: nextMeta };
  await prisma.note.update({
    where: { id: noteId },
    data: { inferenceLog: next as unknown as Prisma.InputJsonValue },
  });
}
