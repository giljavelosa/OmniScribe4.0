/**
 * Unit 49 §G — Pre-sign intent ⇆ case fit checker.
 *
 * **Pure** rule-based comparison (NO LLM call — spec D-U49-8: Cleo
 * never reads draft narrative pre-sign; she only compares two STRUCTURED
 * fields: `Encounter.intent` (set at start-visit per Unit 48 PR1) and
 * `CaseManagement.primaryIcd`).
 *
 * The /review screen renders a one-line chip near the Sign button (gated
 * behind `cleo.caseRule.v1`). The chip is a soft nudge — the clinician
 * proceeds or reviews; nothing is blocked. The whole point is to surface
 * a likely typo / wrong-case-attached situation BEFORE the note is signed,
 * not to question clinical judgment.
 *
 * Rule-20 invariant: the input universe is two structured fields and the
 * organization's division/profession context. No draft text crosses this
 * boundary. Auditors can reconstruct exactly what Cleo saw.
 *
 * Outcomes:
 *
 *   FITS         — strong affinity match between intent and case ICD
 *                  (intent's ICD-prefix table maps to primaryIcd or
 *                  secondaryIcd). Renders no chip / quiet acknowledgement.
 *   LIKELY_FITS  — intent has no defined affinity OR the case has no
 *                  primary ICD, so the system can't prove a misfit.
 *                  Renders no chip — silent default.
 *   MISFITS      — intent has affinity prefixes AND primaryIcd is set
 *                  AND neither primary nor secondary ICD matches.
 *                  Renders the chip.
 *
 * Same affinity table as the case-nominator (single source of truth)
 * so a case that the nominator favored is guaranteed to FIT against
 * the same intent. Re-uses `intentMatchesCase` to keep the bridge
 * tight.
 */

import type { EncounterIntent } from '@prisma/client';

import { intentMatchesCase } from '@/services/copilot/case-nominator';

export type IntentCaseFitVerdict = 'FITS' | 'LIKELY_FITS' | 'MISFITS';

export type IntentCaseFitInput = {
  /** Structured intent recorded on the encounter at start-visit time
   *  (Unit 48 PR1). UNSPECIFIED or null → LIKELY_FITS (no opinion). */
  encounterIntent: EncounterIntent | null | undefined;
  /** Case attached to this encounter — only the two ICD fields are read. */
  caseICDs: {
    primaryIcd: string | null;
    secondaryIcd: string | null;
  };
};

export type IntentCaseFitResult = {
  verdict: IntentCaseFitVerdict;
  /** Human-readable rationale. Always populated. Renders verbatim in the
   *  chip when verdict === 'MISFITS'. */
  reason: string;
  /** When FITS: the matched ICD (so the tooltip can say "M54.50
   *  matched"). Otherwise null. */
  matchedIcd: string | null;
};

/**
 * Evaluate intent ⇆ case fit. Pure; no DB calls.
 */
export function evaluateIntentCaseFit(input: IntentCaseFitInput): IntentCaseFitResult {
  const intent = input.encounterIntent ?? null;

  // UNSPECIFIED / null intent → no opinion. Don't render a chip.
  if (!intent || intent === 'UNSPECIFIED') {
    return {
      verdict: 'LIKELY_FITS',
      reason: 'Visit intent not specified — no fit check performed.',
      matchedIcd: null,
    };
  }

  // Primary ICD missing → can't prove a misfit. Don't render a chip.
  if (!input.caseICDs.primaryIcd) {
    return {
      verdict: 'LIKELY_FITS',
      reason: 'Attached case has no primary ICD — no fit check performed.',
      matchedIcd: null,
    };
  }

  const matched = intentMatchesCase(intent, input.caseICDs);
  if (matched) {
    return {
      verdict: 'FITS',
      reason: `Visit intent matches case ICD (${matched}).`,
      matchedIcd: matched,
    };
  }

  // We KNOW the intent has affinity prefixes (otherwise
  // `intentMatchesCase` would have matched any prefix-less case as
  // LIKELY_FITS via the next clause). So this is a true MISFIT.
  //
  // Defensive: if intent has NO affinity prefixes defined (e.g.
  // MEDICAL_FOLLOW_UP), we don't have enough signal to call it a
  // misfit — fall through to LIKELY_FITS instead.
  const intentHasAffinity = intentHasDefinedAffinity(intent);
  if (!intentHasAffinity) {
    return {
      verdict: 'LIKELY_FITS',
      reason: `Visit intent (${humanizeIntent(intent)}) has no specific ICD affinity — assumed to fit.`,
      matchedIcd: null,
    };
  }

  return {
    verdict: 'MISFITS',
    reason: composeMisfitReason(intent, input.caseICDs),
    matchedIcd: null,
  };
}

/**
 * Mirror of `INTENT_ICD_AFFINITY` from case-nominator — kept private to
 * each module so the affinity table has one editor (the nominator), and
 * this checker just asks "does this intent have ANY affinity defined?"
 * via a probe call. Probes a synthetic "all prefixes" string so any
 * defined prefix matches.
 *
 * Simpler/cheaper alternative would be to export the table from the
 * nominator. We do the probe because it's three lines and keeps the
 * affinity table truly private to the nominator (single editor, fewer
 * accidental drift surfaces).
 */
function intentHasDefinedAffinity(intent: EncounterIntent): boolean {
  // Try a few common ICD prefixes — any match means the intent has
  // affinity defined. Covers all current affinity prefixes (M/S/F/Z).
  const probes = ['M99.99', 'S99.99', 'F99.9', 'Z99.9', 'A99.9', 'B99.9'];
  for (const icd of probes) {
    if (intentMatchesCase(intent, { primaryIcd: icd, secondaryIcd: null }) !== null) {
      return true;
    }
  }
  return false;
}

function composeMisfitReason(
  intent: EncounterIntent,
  caseICDs: { primaryIcd: string | null; secondaryIcd: string | null },
): string {
  const intentText = humanizeIntent(intent);
  const icds = [caseICDs.primaryIcd, caseICDs.secondaryIcd].filter(Boolean).join(' / ');
  return `Visit intent (${intentText}) doesn't match this case's ICD${icds ? ` (${icds})` : ''}. Review the case attachment before signing.`;
}

function humanizeIntent(intent: EncounterIntent): string {
  const [head, ...rest] = intent.split('_');
  return [head, ...rest.map((s) => s.toLowerCase())].join(' ');
}
