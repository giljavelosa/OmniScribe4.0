/**
 * Unit 48 PR4 — REHAB Re-evaluation brief spine.
 *
 * Sibling pattern (Decision 11): appended to BRIEF_SYSTEM_PROMPT for the
 * REHAB_REEVAL intent. The clinician's task at a re-eval is to re-baseline:
 * every objective measure needs its full history (not just the 3 most-
 * recent values the base schema captures) so trajectories can be read
 * across the whole episode, and goals are surfaced with revision
 * opportunities so the clinician knows which to advance / modify / retire.
 *
 * Source rules:
 *   - references/visit-type-taxonomy.md §3.1 — REHAB_REEVAL is "distinct
 *     from the periodic Progress Note. Required when status change warrants
 *     new tests/measures."
 *   - taxonomy §7 — REEVAL spine: full objective measure history + revision
 *     opportunities + goalLedger (reused from PROGRESS).
 *   - CPT 97164/97168 — re-eval billable only when status change documented;
 *     the medical-necessity reasoning lives in the note itself, not the brief.
 */

import type { Division } from '@prisma/client';

import {
  RehabReevalBriefShapeSchema,
  type RehabReevalBriefShape,
} from '@/types/brief-intent-shapes';
import type { BuildBriefPromptInput } from '@/lib/notes/build-brief-prompt';

export const REHAB_REEVAL_SYSTEM_FRAGMENT = `
=== UNIT 48 — REHAB RE-EVALUATION SPINE ===

This visit is a CPT 97164/97168 re-evaluation (distinct from a periodic
Progress Note). The clinician needs THREE things you don't include in a
generic brief:

(1) GOAL LEDGER
Same as the Progress Note spine — ONE entry per active goal in the
<active_goals> input block, never skip:
  - goalText (verbatim), goalType (LTG/STG), status (ACTIVE/MET/...),
    delta (≤80 chars or null), sourceNoteId

(2) OBJECTIVE MEASURE HISTORY
Add a top-level "objectiveMeasureHistory" array. ONE entry per measure
that's been tracked across this episode (ROM, MMT, NPRS, outcome
screeners — LEFS/ODI/NDI/DASH/6MWT/TUG):
  - measureKey       (lower-kebab — "pain-nrs", "rom-knee-flex", "lefs", etc.)
  - measureLabel     (human-readable display)
  - unit             (string or null — "/10", "°", "%", null for indices)
  - history          (≥1 entry: { date, value, sourceNoteId } — oldest to
                      newest across the WHOLE episode, not just last 3)
  - trend            ("improving" | "stable" | "worsening" | "unknown")

The base schema's objectiveMeasures still emits; objectiveMeasureHistory
is the deeper, full-episode view re-eval requires.

(3) REVISION OPPORTUNITIES
Add a top-level "revisionOpportunities" array. ONE entry per goal that
warrants revision — flatlined ≥ 2 visits, achieved, regressing, or
displaced by a new diagnosis. Each entry:
  - goalText        (verbatim from the goal)
  - reason          (≤160 chars — 1 short sentence; "plateau ≥ 3 visits",
                     "achieved 6 weeks ago", "regression after new MVA")
  - direction       ("advance" | "modify" | "retire" | "replace")
                     — the clinician decides; Cleo extracts the candidate
  - sourceNoteId    (note that establishes the flag)

If no goals warrant revision, emit an empty array — never invent reasons.

OUTPUT FORMAT
Your JSON output for this intent MUST include all base-schema fields PLUS
the three new top-level fields above. No markdown fences. JSON only.
`.trim();

export function synthesizeStubRehabReevalBrief(
  input: BuildBriefPromptInput,
  baseStub: Omit<RehabReevalBriefShape, 'goalLedger' | 'objectiveMeasureHistory' | 'revisionOpportunities'>,
): RehabReevalBriefShape {
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
          goalText: '[stub goal — real Bedrock would surface every active goal]',
          goalType: 'LTG' as const,
          status: 'ACTIVE' as const,
          delta: null,
          sourceNoteId,
        },
      ];

  return {
    ...baseStub,
    goalLedger,
    objectiveMeasureHistory: [
      {
        measureKey: 'stub-measure',
        measureLabel: '[stub measure — real Bedrock would build per-measure histories]',
        unit: null,
        history: [{ date: input.todayIso.slice(0, 10), value: '0', sourceNoteId }],
        trend: 'unknown' as const,
      },
    ],
    revisionOpportunities: [],
  };
}

export const REHAB_REEVAL_SPINE = {
  division: 'REHAB' as Division,
  intent: 'REHAB_REEVAL' as const,
  systemPromptFragment: REHAB_REEVAL_SYSTEM_FRAGMENT,
  outputSchema: RehabReevalBriefShapeSchema,
  stubSynthesizer: synthesizeStubRehabReevalBrief,
} as const;
