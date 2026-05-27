/**
 * Pure helpers for reasoning about a note's flag-analysis lifecycle.
 *
 * Two timestamps on Note drive lifecycle gating:
 *
 *   flagAnalysisStartedAt   — stamped by POST /analyze-flags at enqueue
 *                             time. Cleared/overwritten on each new run
 *                             so the latest request wins.
 *   flagAnalysisCompletedAt — stamped by the worker in a finally block.
 *                             NULL means "never analyzed" OR "running
 *                             since startedAt".
 *
 * State machine:
 *   - both NULL                    → 'idle'      (never analyzed)
 *   - started ≠ null, completed null → 'pending' (worker running)
 *   - started ≠ null, completed < started → 'pending' (newer run still running)
 *   - started ≠ null, completed ≥ started → 'completed'
 *
 * Stale-pending guard: a worker that crashes before its finally runs
 * would leave the gate stuck on 'pending' forever. To prevent permanent
 * sign-block from a dead worker, callers can use `STALE_PENDING_MS` to
 * downgrade a pending state to 'completed' when more than the threshold
 * has passed since `startedAt`. The threshold is generous (10 min) —
 * typical analyses finish in < 1 min, and BullMQ retries (3 attempts
 * with exponential backoff) will normally re-stamp completedAt long
 * before the threshold trips.
 *
 * Sprint 0 lockdown additions:
 *
 *   signatureFor(sectionId, claim)         → sha256(sectionId + '|' + normalize(claim))
 *   hashSectionContent(content)            → sha256(content)
 *   computeSectionHashes(draftJson, ids)   → { [sectionId]: hash }
 *   hasEditsSinceLastAnalysis(prior, now)  → boolean + list of edited section ids
 *
 * The signature is the carry-forward key — a re-analyze that emits a
 * claim whose signature matches a prior RESOLVED/DISMISSED row on the
 * same note carries the prior decision forward. The section hashes are
 * the diff-skip key (re-analyze unchanged sections is a no-op) AND the
 * edited-since-analysis gate at sign time.
 */

import { createHash } from 'node:crypto';

/** A pending analysis older than this is treated as stale (worker died). */
export const STALE_PENDING_MS = 10 * 60 * 1000;

export type FlagAnalysisState = 'idle' | 'pending' | 'completed';

export type FlagAnalysisLifecycle = {
  flagAnalysisStartedAt: Date | null;
  flagAnalysisCompletedAt: Date | null;
};

/**
 * Returns 'pending' when an analysis is in flight (and within the stale
 * window). Pure + side-effect free so the sign route, the GET /flags
 * route, and the UI can all derive the same answer.
 */
export function deriveFlagAnalysisState(
  lifecycle: FlagAnalysisLifecycle,
  now: Date = new Date(),
): FlagAnalysisState {
  const { flagAnalysisStartedAt, flagAnalysisCompletedAt } = lifecycle;
  if (!flagAnalysisStartedAt) return 'idle';
  const startedMs = flagAnalysisStartedAt.getTime();
  const completedMs = flagAnalysisCompletedAt?.getTime() ?? 0;
  if (completedMs >= startedMs) return 'completed';
  // Started but no completion — pending unless stale.
  if (now.getTime() - startedMs > STALE_PENDING_MS) return 'completed';
  return 'pending';
}

export function isFlagAnalysisPending(
  lifecycle: FlagAnalysisLifecycle,
  now: Date = new Date(),
): boolean {
  return deriveFlagAnalysisState(lifecycle, now) === 'pending';
}

// ===========================================================================
// Sprint 0 flag-analysis lockdown — signature + hash helpers.
//
// These are PURE so the worker, the routes, the sign client, and the unit
// tests can compute the same values without DB round-trips.
// ===========================================================================

/** Hard cap on analyzer runs per note (initial AUTO_ON_DRAFT + 1 retry). */
export const FLAG_ANALYSIS_RUN_CAP = 2;

/**
 * Normalize a claim string so semantically-identical model outputs hash
 * to the same signature even when the model rewords slightly between
 * runs. Cheap lexical normalization — not embedding-similarity. The
 * trade-off is documented in the spec; signature mismatch on a deep
 * paraphrase is acceptable because the carry-forward branch fails open
 * (the new flag just lands as a fresh OPEN row, no decision lost).
 */
export function normalizeClaim(claim: string): string {
  return claim
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Stable per-claim signature scoped to a single section. Always uses
 * sectionId as the first half so the same wording in two different
 * sections hashes differently — sections are independent analyzer
 * contexts and carrying a decision across them would be wrong.
 *
 * Mirrored exactly in the migration's SQL backfill (best-effort).
 */
export function signatureFor(sectionId: string, claim: string): string {
  return createHash('sha256')
    .update(sectionId + '|' + normalizeClaim(claim))
    .digest('hex');
}

/**
 * Hash a single section's draft content. Used at the end of every
 * analyzer run to snapshot what was just analyzed; used at sign time
 * to detect post-analysis edits.
 *
 * Pure: empty / undefined → empty-string hash so the diff-vs-prior
 * check has consistent semantics for "section had no content."
 */
export function hashSectionContent(content: string | null | undefined): string {
  return createHash('sha256').update(content ?? '').digest('hex');
}

/**
 * Compute `{ [sectionId]: hash }` over the sections the analyzer is
 * about to look at. We deliberately key by sectionId (not section
 * order) so a template that reorders sections later doesn't invalidate
 * historical comparisons.
 *
 * `draftJson` is the Prisma JSON column — a map of sectionId → { content, ... }.
 * Sections without a row in draftJson hash to the empty-string hash
 * (the analyzer skips them anyway; the hash exists so the snapshot is
 * complete and the edits-detection helper doesn't get confused).
 */
export function computeSectionHashes(
  draftJson: Record<string, { content?: string | null }> | null | undefined,
  sectionIds: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const draft = draftJson ?? {};
  for (const id of sectionIds) {
    out[id] = hashSectionContent(draft[id]?.content ?? '');
  }
  return out;
}

/**
 * Compare a fresh hash map to a snapshot stored on Note.flagAnalysisSectionHashes
 * and return the ids of sections whose content has changed.
 *
 * `prior === null` (note never analyzed) returns `{ edited: false, ids: [] }`
 * — the gate is a no-op until the first analyzer run has populated a
 * baseline. This is what makes the sign-time edited-since-analysis
 * check backward-compatible with pre-deploy notes.
 *
 * `prior` may omit ids that exist in `current` (template added a
 * section after the prior run) — those are NOT counted as edits;
 * the new section will get its own analysis on the next re-analyze.
 */
export function diffSectionHashes(
  prior: Record<string, string> | null | undefined,
  current: Record<string, string>,
): { edited: boolean; editedSectionIds: string[] } {
  if (!prior) return { edited: false, editedSectionIds: [] };
  const editedSectionIds: string[] = [];
  for (const [id, hash] of Object.entries(current)) {
    const before = prior[id];
    if (before !== undefined && before !== hash) {
      editedSectionIds.push(id);
    }
  }
  return { edited: editedSectionIds.length > 0, editedSectionIds };
}

/**
 * Convenience boolean form of `diffSectionHashes` — used by the sign
 * route's gate where we only care about the edited/not-edited bit and
 * the list is logged separately.
 */
export function hasEditsSinceLastAnalysis(
  prior: Record<string, string> | null | undefined,
  current: Record<string, string>,
): boolean {
  return diffSectionHashes(prior, current).edited;
}

/**
 * Parse Note.flagAnalysisSectionHashes (Prisma JSON) into the typed map
 * the helpers above expect. Best-effort: malformed JSON returns null
 * (treated as "no baseline" — gates become no-ops). Never throws — the
 * sign route + the analyzer's diff-skip can't afford a parse error to
 * 500 the request.
 */
export function parseSectionHashes(
  raw: unknown,
): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === 'string' && typeof v === 'string') {
      out[k] = v;
    }
  }
  return Object.keys(out).length === 0 ? null : out;
}
