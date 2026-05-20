/**
 * Read/write helpers for Note.inferenceLog._sectionStatus + _regenerations.
 *
 * Shape (spec §F):
 *   inferenceLog: {
 *     _sectionStatus: {
 *       [sectionId]: {
 *         status: 'empty' | 'generating' | 'populated' | 'edited' | 'failed';
 *         progressPercent?: number;
 *         generationStartedAt?: ISO;
 *         lastGeneratedAt?: ISO;
 *         lastEditedAt?: ISO;
 *         error?: { code: string; message: string };
 *         model?: string;
 *         latencyMs?: number;
 *         tokensIn?: number;
 *         tokensOut?: number;
 *       }
 *     },
 *     _regenerations: Array<{
 *       sectionId: string;
 *       requestId: string;
 *       triggeredByUserId?: string;
 *       at: ISO;
 *       overwroteEdited: boolean;
 *     }>;
 *   }
 *
 * PHI-free: this lives in audit log + admin views downstream. Only timing,
 * status, model metadata — never section content.
 */

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export type SectionStatusKind = 'empty' | 'generating' | 'populated' | 'edited' | 'failed';

export type SectionStatusEntry = {
  status: SectionStatusKind;
  progressPercent?: number;
  generationStartedAt?: string;
  lastGeneratedAt?: string;
  lastEditedAt?: string;
  error?: { code: string; message: string };
  model?: string;
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
};

export type RegenerationEntry = {
  sectionId: string;
  requestId: string;
  triggeredByUserId?: string;
  at: string;
  overwroteEdited: boolean;
  /** The content that was REPLACED by this regenerate. Captured at the
   *  moment of regenerate so the diff dialog can render "what changed."
   *  Unit 10. Bounded by appendRegeneration's per-section cap (10) so
   *  the inferenceLog Json doesn't grow unbounded. */
  previousContent?: string;
};

/** Per-section cap on _regenerations entries with `previousContent`. The
 *  per-section history bounds memory growth (a long visit with many
 *  regenerates would otherwise accumulate large content snapshots). */
export const REGENERATION_HISTORY_CAP_PER_SECTION = 10;

export type SectionStats = {
  totalAttempts: number;
  successCount: number;
  failureCount: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  lastUpdatedAt: string;
  /** Rolling window of recent attempt latencies (cap RECENT_LATENCY_CAP)
   *  used to compute online p50/p95. */
  recentLatenciesMs: number[];
};

/**
 * Per-section content fingerprint from the last analyze-flags run. Lets the
 * "Re-analyze" action skip sections whose draft text is byte-identical to
 * what was already analyzed — re-running the LLM on unchanged text only
 * invites non-determinism to flip flags between runs. PHI-free: a SHA-256
 * hash of the section content, never the content itself.
 */
export type FlagAnalysisEntry = {
  contentHash: string;
  analyzedAt: string;
};

export type InferenceLog = {
  _sectionStatus?: Record<string, SectionStatusEntry>;
  _regenerations?: RegenerationEntry[];
  _sectionStats?: SectionStats;
  /** Keyed by sectionId — see FlagAnalysisEntry. */
  _flagAnalysis?: Record<string, FlagAnalysisEntry>;
};

/** Rolling-window cap for recentLatenciesMs. 50 attempts is enough for
 *  stable online p50/p95 without bloating the Json column. */
export const RECENT_LATENCY_CAP = 50;

export function readInferenceLog(value: unknown): InferenceLog {
  if (!value || typeof value !== 'object') return {};
  return value as InferenceLog;
}

export function readSectionStatus(value: unknown): Record<string, SectionStatusEntry> {
  return readInferenceLog(value)._sectionStatus ?? {};
}

/**
 * Atomic update of a single section's status. Loads the current log, merges,
 * and writes back. Callers should be the only writers (i.e. only the
 * worker + the section edit/regenerate endpoints) to keep merges safe.
 */
export async function markSectionStatus(
  noteId: string,
  sectionId: string,
  patch: Partial<SectionStatusEntry> & { status: SectionStatusKind },
): Promise<void> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { inferenceLog: true },
  });
  if (!note) throw new Error(`markSectionStatus: note ${noteId} not found`);

  const log = readInferenceLog(note.inferenceLog);
  const current = log._sectionStatus ?? {};
  const updated: InferenceLog = {
    ...log,
    _sectionStatus: {
      ...current,
      [sectionId]: { ...current[sectionId], ...patch },
    },
  };
  await prisma.note.update({
    where: { id: noteId },
    data: { inferenceLog: updated as unknown as Prisma.InputJsonValue },
  });
}

export async function appendRegeneration(
  noteId: string,
  entry: RegenerationEntry,
): Promise<void> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { inferenceLog: true },
  });
  if (!note) throw new Error(`appendRegeneration: note ${noteId} not found`);
  const log = readInferenceLog(note.inferenceLog);
  const all = [...(log._regenerations ?? []), entry];

  // Cap per-section history of entries CARRYING previousContent so the
  // inferenceLog Json doesn't grow unbounded across long visits. We keep
  // every regeneration's metadata, but only the most recent
  // REGENERATION_HISTORY_CAP_PER_SECTION per section retain previousContent.
  const trimmed = trimRegenerationHistory(all);

  const next: InferenceLog = {
    ...log,
    _regenerations: trimmed,
  };
  await prisma.note.update({
    where: { id: noteId },
    data: { inferenceLog: next as unknown as Prisma.InputJsonValue },
  });
}

/**
 * Update aggregate _sectionStats with the result of one attempt. Online
 * p50/p95 over the rolling window. PHI-free; safe to surface in admin
 * observability dashboards.
 */
export async function recordSectionAttempt(
  noteId: string,
  attempt: { latencyMs: number; success: boolean },
): Promise<void> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { inferenceLog: true },
  });
  if (!note) throw new Error(`recordSectionAttempt: note ${noteId} not found`);
  const log = readInferenceLog(note.inferenceLog);
  const prev: SectionStats =
    log._sectionStats ?? {
      totalAttempts: 0,
      successCount: 0,
      failureCount: 0,
      latencyP50Ms: null,
      latencyP95Ms: null,
      lastUpdatedAt: new Date(0).toISOString(),
      recentLatenciesMs: [],
    };
  const recent = [...prev.recentLatenciesMs, attempt.latencyMs].slice(-RECENT_LATENCY_CAP);
  const next: SectionStats = {
    totalAttempts: prev.totalAttempts + 1,
    successCount: prev.successCount + (attempt.success ? 1 : 0),
    failureCount: prev.failureCount + (attempt.success ? 0 : 1),
    latencyP50Ms: percentile(recent, 0.5),
    latencyP95Ms: percentile(recent, 0.95),
    lastUpdatedAt: new Date().toISOString(),
    recentLatenciesMs: recent,
  };
  const merged: InferenceLog = { ...log, _sectionStats: next };
  await prisma.note.update({
    where: { id: noteId },
    data: { inferenceLog: merged as unknown as Prisma.InputJsonValue },
  });
}

/**
 * Persist the per-section content fingerprints produced by an analyze-flags
 * run. Read-modify-write against a FRESH inferenceLog read (same pattern as
 * markSectionStatus) so a concurrent _sectionStatus / _regenerations write
 * isn't clobbered. Callers pass the full next _flagAnalysis map.
 */
export async function recordFlagAnalyses(
  noteId: string,
  analyses: Record<string, FlagAnalysisEntry>,
): Promise<void> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { inferenceLog: true },
  });
  if (!note) throw new Error(`recordFlagAnalyses: note ${noteId} not found`);
  const log = readInferenceLog(note.inferenceLog);
  const next: InferenceLog = { ...log, _flagAnalysis: analyses };
  await prisma.note.update({
    where: { id: noteId },
    data: { inferenceLog: next as unknown as Prisma.InputJsonValue },
  });
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx] ?? null;
}

/**
 * Per-section: keep all entries, but strip previousContent off any entry
 * outside the most-recent REGENERATION_HISTORY_CAP_PER_SECTION window.
 * The audit-trail metadata (who/when/overwroteEdited) is preserved; only
 * the heavy content snapshot is dropped.
 */
export function trimRegenerationHistory(entries: RegenerationEntry[]): RegenerationEntry[] {
  const bySectionRecentFirst = new Map<string, number>();
  // First pass: walk newest → oldest, track count per section.
  const result: RegenerationEntry[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    const count = bySectionRecentFirst.get(e.sectionId) ?? 0;
    if (count >= REGENERATION_HISTORY_CAP_PER_SECTION && e.previousContent !== undefined) {
      const { previousContent: _drop, ...rest } = e;
      void _drop;
      result.unshift(rest);
    } else {
      result.unshift(e);
    }
    bySectionRecentFirst.set(e.sectionId, count + 1);
  }
  return result;
}

/**
 * Used by the worker to merge a freshly-generated section into draftJson.
 * draftJson shape: { [sectionId]: { content: string, updatedAt: ISO } }
 * Atomic in the sense that we only touch one key — other sections are
 * preserved verbatim (no read-modify-write race because BullMQ runs the
 * worker single-flight per jobId).
 */
export async function mergeSectionIntoDraft(
  noteId: string,
  sectionId: string,
  content: string,
): Promise<void> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { draftJson: true, status: true },
  });
  if (!note) throw new Error(`mergeSectionIntoDraft: note ${noteId} not found`);
  if (note.status === 'SIGNED') {
    // Rule 3 — finalJson is immutable AND no further edits to a signed note's
    // draftJson either. Worker should never reach here on a signed note (the
    // regenerate endpoint guards), but defense-in-depth.
    throw new Error('Cannot modify a SIGNED note');
  }
  const current = (note.draftJson as Record<string, { content: string; updatedAt: string }> | null) ?? {};
  const next = {
    ...current,
    [sectionId]: { content, updatedAt: new Date().toISOString() },
  };
  await prisma.note.update({
    where: { id: noteId },
    data: { draftJson: next as unknown as Prisma.InputJsonValue },
  });
}
