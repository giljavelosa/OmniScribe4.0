/**
 * Unit 49 §F — Case nominator.
 *
 * Pure, deterministic service (NO LLM call — spec D-U49-7: Cleo's
 * nominator is rule-based; reasoning is composable + auditable). Given
 * the patient's active cases + an optional Cleo-proposed `EncounterIntent`
 * for the pending visit, picks ONE "best match" case and returns a
 * short human-readable reason explaining WHY it's the best match.
 *
 * Caller is the start-visit dialog (gated by `cleo.caseRule.v1`): the
 * nominated case wears a `<CaseSuggestionBadge>` and a tooltip with
 * the reason. Clinician retains full authority — the radio dot moves
 * with the user's selection; the badge stays on the recommendation
 * (mirrors the existing `isHero` pattern in CaseRadio).
 *
 * Inputs come pre-filtered for the rule itself: Unit 49 PR1 already
 * scopes the cases the picker can see to `division IN (viewer, MULTI)`.
 * The nominator just ranks within that filtered set; it does NOT
 * re-validate division (callers have already enforced it).
 *
 * Algorithm (highest signal wins; tied at every level falls through):
 *
 *   1. INTENT MATCH — if a proposed intent maps to one of the case's
 *      ICDs (e.g., REHAB_PROGRESS_NOTE → matches M54.50 lumbago active
 *      REHAB case). Encoded via a small `intentICDAffinity` lookup
 *      table. Returns 100 + (recency bonus 0-9).
 *   2. VIEWER RECENCY — viewer's own last activity on the case
 *      (`viewerLastActivityAt`). Mirrors `sortCasesByViewerRecency`'s
 *      tier 1. Returns 50 + (recency bonus 0-9).
 *   3. DIVISION RECENCY — anyone in the viewer's division last
 *      touched the case. Returns 25 + (recency bonus 0-9).
 *   4. OVERALL RECENCY — anyone touched the case. Returns 10 +
 *      (recency bonus 0-9).
 *   5. NO SIGNAL — score 0; case still listed but won't be nominated.
 *
 * Recency bonus: case scored on a 0..9 scale by days-since-activity
 * (today=9, 1d=8, 2-3d=7, 4-7d=6, 8-14d=5, 15-30d=4, 31-60d=3,
 * 61-90d=2, 91-180d=1, >180d=0). Keeps the most-recent case ahead
 * within a tier; doesn't override the tier itself.
 *
 * Reason string is composed from the WINNING tier + recency tail, so
 * the tooltip reads natural: "Recent intent match (M54.50 lumbago) +
 * your active case · last activity 3d ago".
 */

import type { Division, EncounterIntent } from '@prisma/client';

import { sortCasesByViewerRecency, type ViewerRecencySignals } from '@/lib/case-management/sort';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type NominatorCase = ViewerRecencySignals & {
  id: string;
  primaryIcd: string | null;
  primaryIcdLabel: string;
  secondaryIcd: string | null;
};

export type NominationInput = {
  cases: readonly NominatorCase[];
  /** Viewer's clinical division — drives the division-recency tiebreaker
   *  + (future) intent-affinity scoping. Pulled from the viewer's
   *  `OrgUser.division`. */
  viewerDivision: Division | null;
  /** Cleo-proposed intent for this pending visit (per Unit 48
   *  IntentProposer + the start-visit dialog flow). Null when intent
   *  isn't yet computed (e.g., clinician opens dialog while the
   *  proposer call is still in flight). When present, intent affinity
   *  is the highest-priority signal. */
  proposedIntent?: EncounterIntent | null;
};

export type NominationResult = {
  /** Cases ordered by `score` desc, then by recency tiebreakers. */
  ranked: NominatedCase[];
  /** The top pick (== ranked[0]) — convenience accessor. Null when
   *  the input has zero cases. */
  nominee: NominatedCase | null;
};

export type NominatedCase = NominatorCase & {
  /** Numeric score 0..109 (see file header for the scale). */
  score: number;
  /** Human-readable explanation of WHY this case scored as it did.
   *  Renders verbatim in the badge's tooltip. */
  reason: string;
};

// ---------------------------------------------------------------------------
// Intent → ICD-prefix affinity table.
//
// Crude but auditable mapping: each EncounterIntent has zero or more
// ICD-prefix hints. A case whose primaryIcd starts with any hinted
// prefix earns the INTENT-MATCH tier. Examples:
//   REHAB_PROGRESS_NOTE → ['M', 'S']   (musculoskeletal + injury)
//   BH_SESSION_INDIVIDUAL → ['F']      (mental + behavioral)
//   MEDICAL_ANNUAL_WELLNESS → ['Z00', 'Z01'] (encounter for exam)
//
// This is a v1 placeholder; the future-proof shape is per-org seeded
// `IcdProfessionEligibility` rows (per Unit 49 PR3 spec). The lookup
// is exported so the badge tooltip can render the matched ICD.
// ---------------------------------------------------------------------------

const INTENT_ICD_AFFINITY: Partial<Record<EncounterIntent, readonly string[]>> = {
  // REHAB — musculoskeletal (M) + injury (S) are the bulk of ortho PT/OT
  REHAB_INITIAL_EVAL: ['M', 'S'],
  REHAB_DAILY_NOTE: ['M', 'S'],
  REHAB_PROGRESS_NOTE: ['M', 'S'],
  REHAB_REEVAL: ['M', 'S'],
  REHAB_DISCHARGE: ['M', 'S'],
  // BEHAVIORAL_HEALTH — mental + behavioral
  BH_INITIAL_ASSESSMENT: ['F'],
  BH_SESSION_INDIVIDUAL: ['F'],
  BH_SESSION_FAMILY: ['F'],
  BH_SESSION_GROUP: ['F'],
  BH_TREATMENT_PLAN_REVIEW: ['F'],
  BH_CRISIS_REASSESSMENT: ['F'],
  BH_DISCHARGE: ['F'],
  // MEDICAL — wellness exams use Z00/Z01; chronic care varies widely
  // so we don't pin a prefix (falls through to recency tiers).
  MEDICAL_ANNUAL_WELLNESS: ['Z00', 'Z01'],
  MEDICAL_DISCHARGE_TCM: ['Z48'], // post-procedural surveillance
  MEDICAL_TELEHEALTH_CHECKIN: [], // intent-agnostic
  MEDICAL_NEW_PATIENT: [],
  MEDICAL_FOLLOW_UP: [],
  MEDICAL_ACUTE_VISIT: [],
  MEDICAL_CHRONIC_CARE: [],
  // UNSPECIFIED has no affinity — falls through to recency.
  UNSPECIFIED: [],
};

/**
 * Does the case's primary or secondary ICD match any prefix the
 * intent has affinity for? Returns the matched prefix (for the
 * tooltip) or null.
 */
export function intentMatchesCase(
  intent: EncounterIntent | null | undefined,
  c: Pick<NominatorCase, 'primaryIcd' | 'secondaryIcd'>,
): string | null {
  if (!intent) return null;
  const prefixes = INTENT_ICD_AFFINITY[intent];
  if (!prefixes || prefixes.length === 0) return null;
  for (const icd of [c.primaryIcd, c.secondaryIcd]) {
    if (!icd) continue;
    for (const prefix of prefixes) {
      if (icd.startsWith(prefix)) return icd;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const TIER_INTENT_MATCH = 100;
const TIER_VIEWER_RECENT = 50;
const TIER_DIVISION_RECENT = 25;
const TIER_OVERALL_RECENT = 10;

/**
 * 0..9 bonus by days-since-activity. Returns 0 for null/missing.
 * Boundaries chosen to give meaningful tiebreakers across a clinical
 * cadence: same-week visits score 6-9; same-month 4-5; same-quarter
 * 2-3; older 0-1.
 */
export function recencyBonus(isoOrNull: string | null, now: Date = new Date()): number {
  if (!isoOrNull) return 0;
  const t = new Date(isoOrNull).getTime();
  if (Number.isNaN(t)) return 0;
  const days = Math.floor((now.getTime() - t) / 86_400_000);
  if (days <= 0) return 9;
  if (days <= 1) return 8;
  if (days <= 3) return 7;
  if (days <= 7) return 6;
  if (days <= 14) return 5;
  if (days <= 30) return 4;
  if (days <= 60) return 3;
  if (days <= 90) return 2;
  if (days <= 180) return 1;
  return 0;
}

/**
 * Compute the tier + reason for a single case. Pure; no DB calls.
 */
function scoreCase(
  c: NominatorCase,
  ctx: { viewerDivision: Division | null; proposedIntent?: EncounterIntent | null; now: Date },
): { score: number; reason: string } {
  const matchedIcd = intentMatchesCase(ctx.proposedIntent, c);
  if (matchedIcd) {
    // Recency bonus uses viewer activity if present, else overall.
    const r = recencyBonus(c.viewerLastActivityAt ?? c.lastActivityAt, ctx.now);
    return {
      score: TIER_INTENT_MATCH + r,
      reason: composeIntentReason(matchedIcd, ctx.proposedIntent!, c, ctx.now),
    };
  }
  if (c.viewerLastActivityAt) {
    const r = recencyBonus(c.viewerLastActivityAt, ctx.now);
    return {
      score: TIER_VIEWER_RECENT + r,
      reason: `Your active case · last activity ${relativeDayLabel(c.viewerLastActivityAt, ctx.now)}`,
    };
  }
  if (c.viewerDivisionLastActivityAt) {
    const r = recencyBonus(c.viewerDivisionLastActivityAt, ctx.now);
    return {
      score: TIER_DIVISION_RECENT + r,
      reason: `Recent ${ctx.viewerDivision ?? 'team'} activity · ${relativeDayLabel(c.viewerDivisionLastActivityAt, ctx.now)}`,
    };
  }
  if (c.lastActivityAt) {
    const r = recencyBonus(c.lastActivityAt, ctx.now);
    return {
      score: TIER_OVERALL_RECENT + r,
      reason: `Most recent activity on this case · ${relativeDayLabel(c.lastActivityAt, ctx.now)}`,
    };
  }
  return { score: 0, reason: 'No recent activity' };
}

function composeIntentReason(
  matchedIcd: string,
  intent: EncounterIntent,
  c: NominatorCase,
  now: Date,
): string {
  const intentLabel = humanizeIntent(intent);
  // Tail signal — viewer activity beats anything else.
  if (c.viewerLastActivityAt) {
    return `Recent intent match (${matchedIcd}) · your active case · last activity ${relativeDayLabel(c.viewerLastActivityAt, now)}`;
  }
  if (c.viewerDivisionLastActivityAt) {
    return `Recent intent match (${matchedIcd}) · ${intentLabel.toLowerCase()} · ${relativeDayLabel(c.viewerDivisionLastActivityAt, now)}`;
  }
  if (c.lastActivityAt) {
    return `Intent match (${matchedIcd}) · ${intentLabel.toLowerCase()} · activity ${relativeDayLabel(c.lastActivityAt, now)}`;
  }
  return `Intent match (${matchedIcd}) · ${intentLabel.toLowerCase()}`;
}

function humanizeIntent(intent: EncounterIntent): string {
  // "REHAB_PROGRESS_NOTE" → "REHAB progress note"; cheap and good
  // enough for badge tooltips. Replace if a richer registry lands.
  const [head, ...rest] = intent.split('_');
  return [head, ...rest.map((s) => s.toLowerCase())].join(' ');
}

function relativeDayLabel(iso: string | null, now: Date): string {
  if (!iso) return 'no activity';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'no activity';
  const days = Math.floor((now.getTime() - t) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1mo ago';
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? '1y ago' : `${years}y ago`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rank cases by Cleo's nomination logic. Returns the full ranked list
 * AND the convenience `nominee` (= ranked[0]).
 *
 * Pure: same input always produces the same output (modulo time).
 * Pass a fixed `now` from the caller in tests for determinism.
 */
export function nominateCases(
  input: NominationInput,
  now: Date = new Date(),
): NominationResult {
  if (input.cases.length === 0) {
    return { ranked: [], nominee: null };
  }

  // Score every case.
  const scored: NominatedCase[] = input.cases.map((c) => ({
    ...c,
    ...scoreCase(c, {
      viewerDivision: input.viewerDivision,
      proposedIntent: input.proposedIntent ?? null,
      now,
    }),
  }));

  // Sort by score desc; tiebreaker = existing viewer-recency sort so the
  // chart's "Your active case" + dialog's pre-selection still align on
  // the same hero when scores tie.
  const ranked = sortCasesByViewerRecency(scored).sort((a, b) => b.score - a.score);
  return { ranked, nominee: ranked[0] ?? null };
}
