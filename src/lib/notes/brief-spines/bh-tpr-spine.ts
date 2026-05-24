/**
 * Unit 48 PR4 — BH Treatment Plan Review brief spine.
 *
 * Sibling pattern (Decision 11): appended to BRIEF_SYSTEM_PROMPT for the
 * BH_TREATMENT_PLAN_REVIEW intent. Most BH payers require TPR every 90
 * days; the clinician's task is to confirm continued treatment is
 * justified (treatment goals + risk trend + proposed plan revisions).
 *
 * Source rules:
 *   - references/visit-type-taxonomy.md §4.1 — BH_TREATMENT_PLAN_REVIEW
 *     "Progress against each goal, revisions, justification for
 *     continuing treatment."
 *   - taxonomy §7 — BH TPR spine: full goal ledger + risk trend + plan
 *     revisions.
 *   - 42 CFR Part 2 sensitivity continues to apply per Rule 7 / Rule 20.
 */

import type { Division } from '@prisma/client';

import {
  BhTprBriefShapeSchema,
  type BhTprBriefShape,
} from '@/types/brief-intent-shapes';
import type { BuildBriefPromptInput } from '@/lib/notes/build-brief-prompt';

export const BH_TPR_SYSTEM_FRAGMENT = `
=== UNIT 48 — BH TREATMENT PLAN REVIEW SPINE ===

This visit is a Treatment Plan Review (most payers: every 90 days). The
clinician needs THREE things you don't include in a generic brief:

(1) GOAL LEDGER
ONE entry per active treatment-plan goal in the <active_goals> input
block — same shape as the REHAB Progress Note spine:
  - goalText, goalType (LTG/STG), status, delta (≤80 chars or null),
    sourceNoteId

(2) RISK TREND
Add a top-level "riskTrend" array. ONE entry per standardized screener
that's been administered across the treatment course (PHQ-9, GAD-7,
C-SSRS, MOOD-RATING). Even ONE administration counts; emit it. Each entry:
  - tool          ("PHQ-9" | "GAD-7" | "C-SSRS" | "MOOD-RATING")
  - values        (≥1 entry: { date, score, sourceNoteId } — oldest to
                   newest; score is a STRING because C-SSRS uses ordinal
                   labels like "Wish to be dead" not numeric scores)
  - trend         ("improving" | "stable" | "worsening" | "unknown")

If a screener has never been administered, omit that tool from the array.
If NO screeners have been administered across the whole course, the
clinician should re-administer today — emit a single placeholder entry
with values: [] is INVALID per schema; instead emit a synthetic
MOOD-RATING entry with trend: "unknown" and the most recent prior note's
date as a single "(not administered)" value to make the gap visible.

(3) PLAN REVISIONS
Add a top-level "planRevisions" array. ONE entry per proposed change to
the treatment plan, grounded in source notes. Each entry:
  - category      ("frequency" | "modality" | "goal" | "medication-ref"
                   | "safety-plan" | "discharge-readiness")
  - proposed      (≤280 chars — 1 sentence describing the change)
  - sourceNoteId  (the note that supports proposing this revision)

If no revisions are warranted, emit an empty array — never invent.

OUTPUT FORMAT
Base-schema fields PLUS the three above. No markdown fences. JSON only.
`.trim();

export function synthesizeStubBhTprBrief(
  input: BuildBriefPromptInput,
  baseStub: Omit<BhTprBriefShape, 'goalLedger' | 'riskTrend' | 'planRevisions'>,
): BhTprBriefShape {
  const sourceNoteId =
    input.priorNotes[input.priorNotes.length - 1]?.noteId ?? 'stub-source';

  const goalLedger = input.topActiveGoals.length
    ? input.topActiveGoals.map((g) => ({
        goalText: g.goalText,
        goalType: (g.goalType === 'LTG' ? 'LTG' : 'STG') as 'LTG' | 'STG',
        status: 'ACTIVE' as const,
        delta: null,
        sourceNoteId,
      }))
    : [
        {
          goalText: '[stub goal — real Bedrock would surface every treatment-plan goal]',
          goalType: 'LTG' as const,
          status: 'ACTIVE' as const,
          delta: null,
          sourceNoteId,
        },
      ];

  return {
    ...baseStub,
    goalLedger,
    riskTrend: [
      {
        tool: 'PHQ-9' as const,
        values: [{ date: input.todayIso.slice(0, 10), score: '(stub)', sourceNoteId }],
        trend: 'unknown' as const,
      },
    ],
    planRevisions: [],
  };
}

export const BH_TPR_SPINE = {
  division: 'BEHAVIORAL_HEALTH' as Division,
  intent: 'BH_TREATMENT_PLAN_REVIEW' as const,
  systemPromptFragment: BH_TPR_SYSTEM_FRAGMENT,
  outputSchema: BhTprBriefShapeSchema,
  stubSynthesizer: synthesizeStubBhTprBrief,
} as const;
