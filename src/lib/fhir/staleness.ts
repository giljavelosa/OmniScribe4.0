/**
 * FHIR resource staleness helper — Unit 21.
 *
 * 7-day threshold per the spec. Pure helper so tests don't need a clock
 * — pass `now` explicitly.
 */

export const FHIR_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Unit 23 / F5: "very stale" threshold drives the second-tier UI chip
 *  on the BriefCard's EHR provenance pills. Aligned with insurance
 *  norms for "data we should not be relying on at all." */
export const FHIR_VERY_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export type StalenessTier = 'fresh' | 'stale' | 'very_stale';

export function isStale(fetchedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - fetchedAt.getTime() > FHIR_STALE_AFTER_MS;
}

/** Three-tier classifier for the F5 EhrSourcePill. Pure function so
 *  staleness logic stays out of the component code. */
export function stalenessTier(fetchedAt: Date, now: Date = new Date()): StalenessTier {
  const age = now.getTime() - fetchedAt.getTime();
  if (age > FHIR_VERY_STALE_AFTER_MS) return 'very_stale';
  if (age > FHIR_STALE_AFTER_MS) return 'stale';
  return 'fresh';
}
