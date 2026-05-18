/**
 * FHIR resource staleness helper — Unit 21.
 *
 * 7-day threshold per the spec. Pure helper so tests don't need a clock
 * — pass `now` explicitly.
 */

export const FHIR_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function isStale(fetchedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - fetchedAt.getTime() > FHIR_STALE_AFTER_MS;
}
