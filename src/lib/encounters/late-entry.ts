/**
 * Late-entry charting — pure validation + day-gap helpers.
 *
 * Spec: context/specs/late-entry-charting.md
 *
 * Kept side-effect-free so the route handler, the worker, and unit tests can
 * all call the same logic without standing up a transaction. The route does
 * the date-of-service ↔ "today" comparison once; downstream consumers
 * (`startVisit`, audit metadata, UI badges) use the precomputed fields.
 */

/** Hard-coded backdating window. Org-configurable later (spec § Non-goals v1). */
export const LATE_ENTRY_MAX_DAYS = 30;

const MS_PER_DAY = 86_400_000;

export type LateEntryEvaluation =
  | {
      ok: true;
      /** Caller-supplied date, snapped to start-of-day in the same TZ as `now`. */
      dateOfService: Date;
      /** True iff dateOfService is at least one full day before today. */
      isLateEntry: boolean;
      /** Integer day-gap (today - dateOfService). Always >= 0. 0 for same-day. */
      lateEntryDaysGap: number;
    }
  | {
      ok: false;
      reason: 'invalid_date' | 'future_date' | 'too_far_back';
    };

/**
 * Round a Date to its calendar-day-start in local time. Late-entry comparisons
 * are day-granular (clinician picked "May 4" — not "May 4 11:42:13"), so we
 * normalize both ends of the gap math to midnight before subtracting.
 */
function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/**
 * Validate a caller-supplied dateOfService against the backdating window +
 * compute the late-entry flag + day gap. The caller is responsible for
 * passing a stable "now" reference (so tests can pin the clock without
 * monkey-patching Date).
 *
 * Returns:
 *   - { ok: true, dateOfService, isLateEntry, lateEntryDaysGap } — pass these
 *     through to `startVisit()`. dateOfService is normalized to the start of
 *     the caller's local day.
 *   - { ok: false, reason } — surface a 400. Reasons:
 *       * 'invalid_date' — could not parse the ISO string.
 *       * 'future_date'  — dateOfService is after today.
 *       * 'too_far_back' — dateOfService is more than LATE_ENTRY_MAX_DAYS
 *                          (30 in v1) before today.
 *
 * Same-day (gap === 0) is a normal visit, NOT a late entry — matches the
 * spec's "24+ hours" threshold (rounding to a full calendar day gap).
 */
export function evaluateDateOfService(input: {
  iso: string;
  now: Date;
}): LateEntryEvaluation {
  const parsed = new Date(input.iso);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, reason: 'invalid_date' };
  }

  const today = startOfLocalDay(input.now);
  const dos = startOfLocalDay(parsed);
  const diffDays = Math.round((today.getTime() - dos.getTime()) / MS_PER_DAY);

  if (diffDays < 0) return { ok: false, reason: 'future_date' };
  if (diffDays > LATE_ENTRY_MAX_DAYS) return { ok: false, reason: 'too_far_back' };

  return {
    ok: true,
    dateOfService: dos,
    isLateEntry: diffDays >= 1,
    lateEntryDaysGap: diffDays,
  };
}
