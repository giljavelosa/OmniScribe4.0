import type { Division as PrismaDivision } from '@prisma/client';

import type { Division } from './registry';

/**
 * derivePatientDivision — Unit 12 §5.3.
 *
 * Precedence: active episode > site default > org default. When the
 * derived value is 'MULTI' (LRCHC reality: one patient active across
 * Rehab + Medical + BH from the same building), the snapshot pipeline
 * falls back to REHAB per the M1 rule documented in
 * references/patient-detail-spec.md §5.3.1 — REHAB is the LRCHC pilot
 * default.
 *
 * This function returns the FULL Prisma Division (including 'MULTI').
 * The caller (build-snapshot-strip) is responsible for the MULTI → REHAB
 * collapse + the debug log for observability.
 */
export function derivePatientDivision(input: {
  activeEpisode: { division: PrismaDivision | null } | null;
  site: { primaryDivision: PrismaDivision | null } | null;
  org: { defaultDivision: PrismaDivision | null; division: PrismaDivision };
}): PrismaDivision {
  if (input.activeEpisode?.division) return input.activeEpisode.division;
  if (input.site?.primaryDivision) return input.site.primaryDivision;
  return input.org.defaultDivision ?? input.org.division;
}

export const MULTI_FALLBACK_DIVISION: Division = 'REHAB';

/** Collapse Prisma Division → renderable Division for the snapshot strip
 *  (the wire shape never emits 'MULTI'). Returns the M1 fallback when
 *  the input is 'MULTI'. */
export function renderDivisionFor(d: PrismaDivision): Division {
  if (d === 'MULTI') return MULTI_FALLBACK_DIVISION;
  return d as Division;
}
