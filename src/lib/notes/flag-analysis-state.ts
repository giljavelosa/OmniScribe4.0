/**
 * Pure helpers for reasoning about a note's flag-analysis lifecycle.
 *
 * Two timestamps on Note drive everything:
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
 */

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
