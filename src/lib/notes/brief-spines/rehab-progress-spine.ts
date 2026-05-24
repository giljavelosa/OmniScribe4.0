/**
 * Unit 48 PR3 — REHAB Progress Note brief spine.
 *
 * Sibling pattern (Decision 11): the existing BRIEF_SYSTEM_PROMPT in
 * build-brief-prompt.ts is NOT modified. This module exports a triple
 * `{ systemPromptFragment, outputSchema, stubSynthesizer }` that the
 * `IntentAwareBriefGenerator` composes with the base prompt envelope:
 *
 *   const systemPrompt = BRIEF_SYSTEM_PROMPT + '\n\n' + spine.systemPromptFragment
 *   validate(llmOutput) using spine.outputSchema
 *
 * Source rules for what this spine asks the model to produce:
 *   - references/visit-type-taxonomy.md §3.1 — REHAB_PROGRESS_NOTE
 *     ("Assessment of improvement against each functional goal,
 *     justification for continued POC, revisions to goals/POC")
 *   - references/visit-type-taxonomy.md §7 — the (REHAB, PROGRESS_NOTE)
 *     spine row enumerates: full goal ledger, objective trend strip,
 *     carryover plan, medical-necessity talking points, suggested data
 *     to capture
 *   - CMS Pub. 100-02 Ch. 15 §220.3 — what an audit-ready Progress
 *     Report must contain
 *
 * Anti-regression posture:
 *   - Rule 20: every value the model emits MUST be grounded in the
 *     source signed notes (anchored by sourceNoteId on every goal
 *     ledger entry). Inherited from base prompt.
 *   - Rule 23 (Cleo cards never make clinical recommendations): the
 *     medical-necessity scaffold extracts talking points the clinician
 *     SAYS — never asserts a recommendation as fact. The prompt
 *     enforces this with the "Cleo extracts; clinician decides"
 *     framing in the fragment below.
 */

import type { Division } from '@prisma/client';

import {
  RehabProgressBriefShapeSchema,
  type RehabProgressBriefShape,
} from '@/types/brief-intent-shapes';
import type { BuildBriefPromptInput } from '@/lib/notes/build-brief-prompt';

/**
 * Appended to BRIEF_SYSTEM_PROMPT for the REHAB_PROGRESS_NOTE intent.
 *
 * Adds two output requirements on top of the base BriefLLMOutputSchema:
 *   1. `goalLedger` — every active LTG + STG from the input's
 *      <active_goals> block, with status + delta + source pill.
 *   2. `medicalNecessity` — three talking-point fields the clinician
 *      will say out loud during the visit (Cleo extracts, never asserts).
 */
export const REHAB_PROGRESS_SYSTEM_FRAGMENT = `
=== UNIT 48 — REHAB PROGRESS NOTE SPINE ===

This visit is a Medicare Part B Progress Report (CMS Pub. 100-02 Ch. 15
§220.3). The clinician needs TWO things you don't include in a generic
brief:

(1) GOAL LEDGER
Add a top-level "goalLedger" array to your JSON output. ONE entry per
active goal in the <active_goals> input block — do not skip any. Each
entry MUST have:
  - goalText        (verbatim from the active_goals block; never paraphrase)
  - goalType        ("LTG" or "STG")
  - status          ("ACTIVE", "MET", "NOT_MET", "MODIFIED", "PARTIALLY_MET", "DEFERRED")
                    — derived from the source notes' latest mention of this goal
  - delta           (short string ≤ 80 chars OR null) — what changed since the
                    last comparable measurement; null when no comparable
                    prior exists
  - sourceNoteId    (one of input.priorNotes[].noteId — the note that
                    establishes the status you assigned)

A Progress Report that doesn't address every goal fails MAC audit. If
<active_goals> is empty, omit the goalLedger field entirely (the
schema permits an empty array but renderers expect ≥1 entry when the
field is present, so omission is cleaner than [] in that edge case).

(2) MEDICAL NECESSITY SCAFFOLD
Add a top-level "medicalNecessity" object with EXACTLY three string
fields:
  - remainingLimitations
      What the patient still cannot do, grounded in the most recent
      prior assessment section. 1–2 sentences. Example phrasing:
      "Unable to climb stairs without rail; unable to lift > 5 lbs
      with R UE."
  - whySkilledCare
      Why skilled therapy is still required (vs. HEP-only), grounded
      in prior plan / intervention sections. 1–2 sentences. Example:
      "Manual joint mobilization grade III + scapular stabilization
      progression require skilled hand placement and dosage
      adjustment; patient cannot self-administer."
  - pocJustification
      Why continuing the POC is justified vs. discharge, grounded in
      trajectory + last assessment. 1–2 sentences. Example:
      "AROM improvements continue at ~10° per progress cycle;
      anticipated 4 more weeks to functional ROM threshold for
      return to overhead work."

These are TALKING POINTS the clinician will say out loud during the
visit — Cleo extracts what's grounded in the chart, never asserts a
recommendation. If a field cannot be grounded in source notes,
phrase it as a question / gap: "Goals last measured 5 visits ago —
remeasurement needed today to justify continued POC." Never invent
clinical conclusions.

OUTPUT FORMAT
Your JSON output for this intent MUST include all fields from the
base schema (patientOneLine, episodeContext, lastVisit, chiefConcern,
priorAssessment, trajectory, objectiveMeasures, interventionsPerformed,
homeProgram, educationGiven, carryForwardPlan, topActiveGoals, watch,
sourceNoteIds) PLUS the two new top-level fields above.

No markdown fences. No commentary. JSON only.
`.trim();

/**
 * Stub-mode synthesizer — produces a minimal valid RehabProgressBriefShape
 * for dev-mode runs when Bedrock isn't configured. Mirrors the
 * synthesizeStubBrief pattern in BriefGenerator.ts so /prepare can
 * render the intent-aware card end-to-end in a fresh dev env.
 *
 * The base BriefGenerator's stub synthesizer (in BriefGenerator.ts)
 * already produces a base BriefLLMOutput; this function extends it with
 * the two intent-specific fields. Callers pass the base stub and we
 * augment.
 */
export function synthesizeStubRehabProgressBrief(
  input: BuildBriefPromptInput,
  baseStub: Omit<RehabProgressBriefShape, 'goalLedger' | 'medicalNecessity'>,
): RehabProgressBriefShape {
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
        // Schema requires ≥1 entry; synthesize one so the renderer can
        // mount in dev without a seeded goal.
        {
          goalText:
            '[stub goal — real Bedrock would extract every active goal here]',
          goalType: 'LTG' as const,
          status: 'ACTIVE' as const,
          delta: null,
          sourceNoteId,
        },
      ];

  return {
    ...baseStub,
    goalLedger,
    medicalNecessity: {
      remainingLimitations:
        '[stub remaining limitations — real Bedrock would ground this in the prior assessment]',
      whySkilledCare:
        '[stub skilled care justification — real Bedrock would cite specific interventions]',
      pocJustification:
        '[stub POC justification — real Bedrock would cite trajectory + visits-remaining]',
    },
  };
}

/**
 * The triple this spine module exports. The `IntentAwareBriefGenerator`
 * looks up the spine by `(division, intent)` and uses these three
 * primitives to drive its generation.
 */
export const REHAB_PROGRESS_SPINE = {
  division: 'REHAB' as Division,
  intent: 'REHAB_PROGRESS_NOTE' as const,
  systemPromptFragment: REHAB_PROGRESS_SYSTEM_FRAGMENT,
  outputSchema: RehabProgressBriefShapeSchema,
  stubSynthesizer: synthesizeStubRehabProgressBrief,
} as const;
