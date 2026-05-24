/**
 * Unit 48 PR3 — intent-aware brief shapes (sibling to BriefLLMOutputSchema).
 *
 * Decision 11: `BriefLLMOutputSchema` in src/types/brief.ts is NOT
 * modified. Spine-specific shapes live here. The `IntentAwareBriefGenerator`
 * chooses which schema to validate against from the (division, intent)
 * pair; the existing `BriefGenerator` never imports or references the
 * schemas in this file.
 *
 * Each shape EXTENDS `BriefLLMOutputSchema` (Zod `.extend()`), so
 * intent-aware briefs validate against the base schema implicitly and
 * the additional intent-specific fields explicitly.
 *
 * PR3 ships ONLY `RehabProgressBriefShapeSchema`. The other three MVP
 * pairs land in PR4 — placeholder exports are commented below.
 */

import { z } from 'zod';

import { BriefLLMOutputSchema, SourcePillSchema } from './brief';

// =============================================================================
// REHAB Progress Note (PR3 — the only spine shipped in this PR).
//
// Per references/visit-type-taxonomy.md §3.1 + §7 row "REHAB · PROGRESS_NOTE":
// the spine foregrounds the FULL goal ledger (all LTGs + STGs with status)
// and the medical-necessity talking points the clinician needs to say out
// loud during the visit. Both are audit-critical for MAC review.
// =============================================================================

/**
 * One row of the full goal ledger. Distinct from the brief schema's
 * `topActiveGoals` (capped at 3) — for a Progress Note, the clinician
 * needs to see every goal and address each one explicitly.
 */
export const GoalLedgerEntrySchema = z.object({
  goalText: z.string().min(1),
  goalType: z.enum(['LTG', 'STG']),
  status: z.enum([
    'ACTIVE',
    'MET',
    'NOT_MET',
    'MODIFIED',
    'PARTIALLY_MET',
    'DEFERRED',
  ]),
  /** Short delta vs. baseline / last progress note. ≤50 chars; null when
   *  no comparable prior measurement exists. */
  delta: z.string().max(80).nullable(),
  sourceNoteId: z.string().min(1),
});
export type GoalLedgerEntry = z.infer<typeof GoalLedgerEntrySchema>;

/**
 * Medical-necessity scaffold. Each field is a 1–2 sentence talking point
 * the clinician says out loud during the visit (and Cleo captures into
 * the note's assessment section). These ARE the audit-critical sentences
 * a MAC reviewer reads to determine if continued therapy is justified.
 *
 * Rule 24: data only, not clinical recommendations. The scaffold extracts
 * what's grounded in prior notes — the clinician decides what to say.
 */
export const MedicalNecessitySchema = z.object({
  /** "What the patient still can't do" — grounded in prior assessment
   *  section. */
  remainingLimitations: z.string().min(1),
  /** "Why skilled care is still required" — grounded in prior plan /
   *  intervention sections. */
  whySkilledCare: z.string().min(1),
  /** "Justification for continuing the POC vs. discharge" — grounded
   *  in the trajectory + last assessment. */
  pocJustification: z.string().min(1),
  /** Optional source pill anchoring the scaffold to the prior progress
   *  note (or IE if no progress note exists yet) the spine drew from. */
  source: SourcePillSchema.optional(),
});
export type MedicalNecessity = z.infer<typeof MedicalNecessitySchema>;

/**
 * Full RehabProgressNote brief shape. The base schema's `topActiveGoals`
 * stays (cap-3 summary for headline rendering), and we add the full
 * `goalLedger` + the `medicalNecessity` scaffold for the Progress Note
 * spine.
 */
export const RehabProgressBriefShapeSchema = BriefLLMOutputSchema.extend({
  goalLedger: z.array(GoalLedgerEntrySchema).min(1),
  medicalNecessity: MedicalNecessitySchema,
});
export type RehabProgressBriefShape = z.infer<typeof RehabProgressBriefShapeSchema>;

// =============================================================================
// PR4 placeholders — these land alongside the other three MVP spine pairs.
// Commented to document intent without surfacing exports that aren't yet
// implemented (clean tree-shaking, no dead-import lint warnings).
// =============================================================================

// export const RehabReevalBriefShapeSchema = BriefLLMOutputSchema.extend({
//   objectiveMeasureHistory: z.array(...),
//   revisionOpportunities: z.array(...),
// });
//
// export const BhTprBriefShapeSchema = BriefLLMOutputSchema.extend({
//   goalLedger: z.array(GoalLedgerEntrySchema).min(1),
//   riskTrend: z.array(...),
//   planRevisions: z.array(...),
// });
//
// export const MedicalAwvBriefShapeSchema = BriefLLMOutputSchema.extend({
//   careGaps: z.array(...),
//   screeningsDue: z.array(...),
//   immunizationsDue: z.array(...),
// });
