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
// REHAB Re-evaluation (PR4).
//
// Per taxonomy §3.1 + §7: re-eval foregrounds the FULL objective measure
// history (every measurement across the episode, not just the last 3 base
// schema gives) + revision-opportunity flags for goals that should be
// re-stated. Reuses the goalLedger from PROGRESS (Rule 20 — full
// per-goal status grounded in source notes).
// =============================================================================

export const ObjectiveMeasureHistorySchema = z.object({
  measureKey: z.string().min(1).max(64),
  measureLabel: z.string().min(1).max(120),
  unit: z.string().nullable(),
  history: z
    .array(
      z.object({
        date: z.string().min(1),
        value: z.string().min(1),
        sourceNoteId: z.string().min(1),
      }),
    )
    .min(1),
  /** Trend across the full history — derived by the model, NOT a fresh
   *  computation each render. */
  trend: z.enum(['improving', 'stable', 'worsening', 'unknown']),
});
export type ObjectiveMeasureHistoryEntry = z.infer<typeof ObjectiveMeasureHistorySchema>;

export const RevisionOpportunitySchema = z.object({
  goalText: z.string().min(1),
  /** Why revision is warranted ("plateau ≥ 2 visits", "achieved",
   *  "regression", "new dx"). 1 short sentence. */
  reason: z.string().min(1).max(160),
  /** Suggested revision direction — the clinician decides; Cleo extracts.
   *  "advance" = make harder; "modify" = change measurement;
   *  "retire" = goal achieved; "replace" = swap for a new STG. */
  direction: z.enum(['advance', 'modify', 'retire', 'replace']),
  sourceNoteId: z.string().min(1),
});
export type RevisionOpportunity = z.infer<typeof RevisionOpportunitySchema>;

export const RehabReevalBriefShapeSchema = BriefLLMOutputSchema.extend({
  goalLedger: z.array(GoalLedgerEntrySchema).min(1),
  objectiveMeasureHistory: z.array(ObjectiveMeasureHistorySchema).min(1),
  revisionOpportunities: z.array(RevisionOpportunitySchema),
});
export type RehabReevalBriefShape = z.infer<typeof RehabReevalBriefShapeSchema>;

// =============================================================================
// BH Treatment Plan Review (PR4).
//
// Per taxonomy §4.1 + §7: TPR foregrounds the FULL goal ledger + risk-tool
// trend (PHQ-9 / GAD-7 / C-SSRS / MOOD-RATING) + proposed plan revisions.
// Risk trend lives as its own field (vs. squeezing into objectiveMeasures)
// so renderers can sparkline it without filtering by measureKey.
// =============================================================================

export const RiskTrendSchema = z.object({
  /** Standardized screener — drives the renderer's sparkline color
   *  (C-SSRS gets danger-tier red, PHQ-9 / GAD-7 get info-tier blue). */
  tool: z.enum(['PHQ-9', 'GAD-7', 'C-SSRS', 'MOOD-RATING']),
  values: z
    .array(
      z.object({
        date: z.string().min(1),
        /** String not number — some tools (C-SSRS) emit ordinal labels
         *  rather than a numeric score. */
        score: z.string().min(1),
        sourceNoteId: z.string().min(1),
      }),
    )
    .min(1),
  trend: z.enum(['improving', 'stable', 'worsening', 'unknown']),
});
export type RiskTrendEntry = z.infer<typeof RiskTrendSchema>;

export const PlanRevisionSchema = z.object({
  /** What dimension of the plan to revise. */
  category: z.enum(['frequency', 'modality', 'goal', 'medication-ref', 'safety-plan', 'discharge-readiness']),
  /** 1 short sentence describing the proposed change. Clinician decides;
   *  Cleo extracts grounded in source notes. */
  proposed: z.string().min(1).max(280),
  sourceNoteId: z.string().min(1),
});
export type PlanRevision = z.infer<typeof PlanRevisionSchema>;

export const BhTprBriefShapeSchema = BriefLLMOutputSchema.extend({
  goalLedger: z.array(GoalLedgerEntrySchema).min(1),
  riskTrend: z.array(RiskTrendSchema).min(1),
  planRevisions: z.array(PlanRevisionSchema),
});
export type BhTprBriefShape = z.infer<typeof BhTprBriefShapeSchema>;

// =============================================================================
// MEDICAL Annual Wellness Visit (PR4).
//
// Per taxonomy §5.1 + §7: AWV foregrounds care gaps + screenings due +
// immunizations due + prior AWV plan items. Drives the renderer's
// preventive-care checklist UI.
// =============================================================================

const DueStatusEnum = z.enum(['overdue', 'due_now', 'due_soon']);
export type DueStatus = z.infer<typeof DueStatusEnum>;

export const CareGapSchema = z.object({
  /** Short label ("Colorectal screening", "A1c", "BP check"). */
  label: z.string().min(1).max(120),
  dueStatus: DueStatusEnum,
  /** ISO date the gap was last addressed; null when never addressed. */
  lastCompletedDate: z.string().nullable(),
  source: SourcePillSchema,
});
export type CareGap = z.infer<typeof CareGapSchema>;

export const ImmunizationDueSchema = z.object({
  vaccine: z.string().min(1).max(120),
  dueStatus: DueStatusEnum,
  lastAdministeredDate: z.string().nullable(),
  source: SourcePillSchema,
});
export type ImmunizationDue = z.infer<typeof ImmunizationDueSchema>;

export const PriorAwvItemSchema = z.object({
  /** Verbatim plan item from the prior AWV note. */
  text: z.string().min(1).max(280),
  sourceNoteId: z.string().min(1),
  /** Was the item resolved since the prior AWV? Null when unknown. */
  resolved: z.boolean().nullable(),
});
export type PriorAwvItem = z.infer<typeof PriorAwvItemSchema>;

export const MedicalAwvBriefShapeSchema = BriefLLMOutputSchema.extend({
  careGaps: z.array(CareGapSchema),
  screeningsDue: z.array(CareGapSchema),
  immunizationsDue: z.array(ImmunizationDueSchema),
  priorAwvItems: z.array(PriorAwvItemSchema),
});
export type MedicalAwvBriefShape = z.infer<typeof MedicalAwvBriefShapeSchema>;
