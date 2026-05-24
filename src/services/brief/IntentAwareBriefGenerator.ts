/**
 * Unit 48 PR3 — Intent-aware brief generator (sibling, not modification).
 *
 * Decision 11 (the spec's risk-reduction mandate): the existing
 * `BriefGenerator` in `./BriefGenerator.ts` is NOT modified by PR3.
 * This sibling class handles the intent-aware path. The
 * `note-brief/handler.ts` worker dispatches between the two at the
 * top of the handler based on `(division, intent)` and falls through
 * to the unchanged BriefGenerator for everything outside
 * `SUPPORTED_INTENT_PAIRS`.
 *
 * Composition shape (mirrors BriefGenerator's envelope without
 * duplicating it semantically):
 *
 *   1. Build the system prompt as `BRIEF_SYSTEM_PROMPT + '\n\n' +
 *      spine.systemPromptFragment`.
 *   2. Build the user message via `buildBriefUserMessage(input)`
 *      (same builder the base generator uses).
 *   3. Call `getLLMService().generate(...)` with the same envelope as
 *      the base generator (Sonnet first, Haiku fallback, two-attempt
 *      re-prompt on schema failure).
 *   4. Validate against the spine's schema (`RehabProgressBriefShapeSchema`
 *      etc.) — NOT the base BriefLLMOutputSchema. Spine schemas extend
 *      the base so all base-shape constraints still apply.
 *   5. Stamp `generatorVersion` so audit metadata records which path
 *      generated the brief.
 *
 * The intent-aware path is REACHABLE only when the worker dispatcher
 * has already verified the (division, intent) pair is supported. The
 * generator throws for unsupported pairs as a defensive belt-and-
 * suspenders — that throw should never fire in practice.
 *
 * PR3 ships ONLY the `REHAB_PROGRESS_NOTE` pair. PR4 adds the other
 * three MVP pairs by registering more spine modules in
 * `SUPPORTED_INTENT_PAIRS` + the `selectSpine` lookup.
 */

import { EncounterIntent, type Division } from '@prisma/client';

import { getLLMService, type LLMService } from '@/services/llm';
import { stripJsonFence } from '@/lib/llm/strip-json-fence';
import {
  BRIEF_SYSTEM_PROMPT,
  buildBriefUserMessage,
  type BuildBriefPromptInput,
} from '@/lib/notes/build-brief-prompt';
import {
  REHAB_PROGRESS_SPINE,
} from '@/lib/notes/brief-spines/rehab-progress-spine';
import type {
  RehabProgressBriefShape,
} from '@/types/brief-intent-shapes';
import type { BriefLLMOutput } from '@/types/brief';

export const INTENT_AWARE_BRIEF_GENERATOR_VERSION = 'llm-v1-intent-rehab-progress';
export const INTENT_AWARE_BRIEF_GENERATOR_FALLBACK_VERSION =
  'llm-v1-intent-rehab-progress-fallback-haiku';

/**
 * The intent-aware path returns one of the spine-specific shapes. v1
 * only ships REHAB_PROGRESS_NOTE; the union grows to include the other
 * three MVP shapes in PR4. Callers narrow on `intent` to access spine-
 * specific fields safely.
 */
export type IntentAwareBriefOutput =
  | (RehabProgressBriefShape & { intent: typeof EncounterIntent.REHAB_PROGRESS_NOTE });

export type IntentAwareBriefGenerationResult = {
  brief: IntentAwareBriefOutput;
  generatorVersion:
    | typeof INTENT_AWARE_BRIEF_GENERATOR_VERSION
    | typeof INTENT_AWARE_BRIEF_GENERATOR_FALLBACK_VERSION;
  model: 'sonnet' | 'haiku';
  attempts: number;
  stub: boolean;
};

/**
 * The set of (division, intent) pairs PR3 + PR4 support. The worker
 * dispatcher consults this Set to decide whether to route to the
 * intent-aware path; encoded as `${division}:${intent}` strings.
 *
 * PR3 ships exactly one pair. PR4 grows this Set to four.
 */
export const SUPPORTED_INTENT_PAIRS: ReadonlySet<string> = new Set<string>([
  `REHAB:${EncounterIntent.REHAB_PROGRESS_NOTE}`,
  // PR4 (placeholder for clarity — uncomment in PR4 alongside the
  // corresponding spine modules):
  // `REHAB:${EncounterIntent.REHAB_REEVAL}`,
  // `BEHAVIORAL_HEALTH:${EncounterIntent.BH_TREATMENT_PLAN_REVIEW}`,
  // `MEDICAL:${EncounterIntent.MEDICAL_ANNUAL_WELLNESS}`,
]);

/**
 * Helper for the worker dispatcher. Returns true when the pair is
 * supported by an intent-aware spine; false otherwise (dispatcher
 * falls through to the existing BriefGenerator). Co-located with
 * SUPPORTED_INTENT_PAIRS so "is this pair supported?" is one import
 * and one source of truth.
 */
export function isIntentAwarePairSupported(
  division: Division,
  intent: EncounterIntent,
): boolean {
  if (intent === EncounterIntent.UNSPECIFIED) return false;
  return SUPPORTED_INTENT_PAIRS.has(`${division}:${intent}`);
}

// =============================================================================
// The generator.
// =============================================================================

export class IntentAwareBriefGenerator {
  constructor(private readonly llm: LLMService = getLLMService()) {}

  /**
   * Generate an intent-aware brief for a single (division, intent) pair.
   *
   * @param input  The same BuildBriefPromptInput the base generator
   *               takes — caller (worker) shares the projection logic.
   * @param intent Which intent to target. MUST be in SUPPORTED_INTENT_PAIRS
   *               for the given input.division; otherwise this throws.
   * @param meter  Optional Unit-35 cost-rollup metering.
   */
  async generate(
    input: BuildBriefPromptInput,
    intent: EncounterIntent,
    meter?: { orgId: string; noteId?: string },
  ): Promise<IntentAwareBriefGenerationResult> {
    const spine = selectSpine(input.division, intent);

    const systemPrompt = `${BRIEF_SYSTEM_PROMPT}\n\n${spine.systemPromptFragment}`;
    const user = buildBriefUserMessage(input);
    let lastValidationError: string | null = null;

    // Two Sonnet attempts with re-prompt on schema failure (mirrors
    // BriefGenerator's envelope).
    for (let attempt = 1; attempt <= 2; attempt++) {
      const augmentedUser = lastValidationError
        ? `${user}\n\nPREVIOUS ATTEMPT FAILED VALIDATION:\n${lastValidationError}\nReturn corrected JSON only.`
        : user;
      const result = await this.llm.generate(systemPrompt, augmentedUser, {
        phi: true,
        temperature: 0,
        jsonMode: true,
        model: 'sonnet',
        maxTokens: 4096,
        ...(meter ? { meter: { ...meter, surface: 'worker.intent-brief.sonnet' } } : {}),
      });
      const parseAttempt = parseSpineOutput(result.text, input, spine);
      if (parseAttempt.ok) {
        return {
          brief: stampIntent(parseAttempt.value, intent),
          generatorVersion: INTENT_AWARE_BRIEF_GENERATOR_VERSION,
          model: 'sonnet',
          attempts: attempt,
          stub: !!result.stub,
        };
      }
      lastValidationError = parseAttempt.error;
    }

    // Haiku fallback — single attempt.
    const result = await this.llm.generate(systemPrompt, user, {
      phi: true,
      temperature: 0,
      jsonMode: true,
      model: 'haiku',
      maxTokens: 4096,
      ...(meter ? { meter: { ...meter, surface: 'worker.intent-brief.haiku' } } : {}),
    });
    const parseAttempt = parseSpineOutput(result.text, input, spine);
    if (!parseAttempt.ok) {
      throw new Error(
        `IntentAwareBriefGenerator: both Sonnet and Haiku produced invalid output for ${input.division}/${intent}. Last error: ${parseAttempt.error}`,
      );
    }
    return {
      brief: stampIntent(parseAttempt.value, intent),
      generatorVersion: INTENT_AWARE_BRIEF_GENERATOR_FALLBACK_VERSION,
      model: 'haiku',
      attempts: 3,
      stub: !!result.stub,
    };
  }
}

// =============================================================================
// Internal helpers.
// =============================================================================

type SupportedSpine = typeof REHAB_PROGRESS_SPINE; // grows to a union in PR4

function selectSpine(division: Division, intent: EncounterIntent): SupportedSpine {
  if (
    division === 'REHAB' &&
    intent === EncounterIntent.REHAB_PROGRESS_NOTE
  ) {
    return REHAB_PROGRESS_SPINE;
  }
  // Defensive — the worker dispatcher should have filtered this out via
  // isIntentAwarePairSupported(). If we get here, the call site has a bug.
  throw new Error(
    `IntentAwareBriefGenerator.selectSpine: unsupported (division, intent) pair: ${division}/${intent}. Caller should have checked isIntentAwarePairSupported() first.`,
  );
}

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function parseSpineOutput(
  rawText: string,
  input: BuildBriefPromptInput,
  spine: SupportedSpine,
): ParseResult<RehabProgressBriefShape> {
  const stripped = stripJsonFence(rawText);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripped);
  } catch {
    return { ok: false, error: `non-JSON response: ${stripped.slice(0, 120)}` };
  }

  // Stub-mode envelope handling — the LLM service returns
  // `{ stub: true, text: ... }` when Bedrock isn't configured. Synthesize
  // a minimal valid spine shape so dev exercises the full pipeline.
  if (
    parsedJson &&
    typeof parsedJson === 'object' &&
    (parsedJson as { stub?: boolean }).stub === true
  ) {
    const baseStub = synthesizeBaseStub(input);
    return { ok: true, value: spine.stubSynthesizer(input, baseStub) };
  }

  const result = spine.outputSchema.safeParse(parsedJson);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.message.slice(0, 600) };
}

/**
 * Stub synthesizer for the BASE shape fields. The spine's
 * `stubSynthesizer` augments this with the intent-specific fields. Mirrors
 * the structure of BriefGenerator's `synthesizeStubBrief` but kept local
 * here so the sibling pattern remains true — we don't reach into the
 * base generator's internals.
 */
function synthesizeBaseStub(
  input: BuildBriefPromptInput,
): Omit<RehabProgressBriefShape, 'goalLedger' | 'medicalNecessity'> {
  const mostRecent = input.priorNotes[input.priorNotes.length - 1];
  if (!mostRecent) {
    throw new Error(
      'IntentAwareBriefGenerator stub: cannot synthesize brief with zero prior notes',
    );
  }
  const daysAgo = Math.max(
    0,
    Math.floor(
      (new Date(input.todayIso).getTime() - new Date(mostRecent.signedAtIso).getTime()) /
        86_400_000,
    ),
  );
  const base: BriefLLMOutput = {
    patientOneLine: `${input.patient.displayAge ?? '?'}${input.patient.sex[0] ?? '?'}, ${input.episode?.diagnosis ?? 'no episode'}`,
    episodeContext: input.episode
      ? {
          episodeId: input.episode.id,
          label: input.episode.label,
          visitNumber: input.episode.visitsCompleted || null,
          plannedVisits: input.episode.visitsAuthorized,
        }
      : null,
    lastVisit: {
      noteId: mostRecent.noteId,
      date: mostRecent.signedAtIso.slice(0, 10),
      daysAgo,
      clinicianName: mostRecent.clinicianName,
      noteType: mostRecent.noteType,
      templateName: mostRecent.templateName,
    },
    chiefConcern: '[stub intent-aware brief — real Bedrock would summarize the chief concern]',
    priorAssessment: '[stub intent-aware brief — real Bedrock would extract the prior assessment]',
    trajectory:
      input.priorNotes.length > 1
        ? { summary: '[stub trajectory]', direction: 'mixed' as const }
        : null,
    objectiveMeasures: [],
    interventionsPerformed: [],
    homeProgram: null,
    educationGiven: [],
    carryForwardPlan: [],
    topActiveGoals: input.topActiveGoals.slice(0, 3).map((g) => ({
      text: g.goalText,
      status: 'active' as const,
      delta: null,
      originNoteId: mostRecent.noteId,
    })),
    watch: {
      recentMedChanges: [],
      recentResults: [],
      precautions: [],
      redFlagsFromPriorNote: [],
    },
    sourceNoteIds: input.priorNotes.map((n) => n.noteId),
  };
  // Strip the optional `ehrEnrichment` field — spine schemas don't
  // require it and the intent-aware path doesn't hydrate it in v1.
  // (The worker still hydrates it on the OUTGOING NoteBrief.content
  // post-validation; see worker handler.)
  return base as Omit<RehabProgressBriefShape, 'goalLedger' | 'medicalNecessity'>;
}

/**
 * Tag the parsed brief with its source intent so downstream consumers
 * (renderer, audit) can discriminate without inspecting other fields.
 * v1 only emits REHAB_PROGRESS_NOTE; PR4 unions in the others.
 */
function stampIntent(
  brief: RehabProgressBriefShape,
  intent: EncounterIntent,
): IntentAwareBriefOutput {
  if (intent === EncounterIntent.REHAB_PROGRESS_NOTE) {
    return { ...brief, intent: EncounterIntent.REHAB_PROGRESS_NOTE };
  }
  // selectSpine already gates this; the throw is unreachable in v1.
  throw new Error(`stampIntent: unsupported intent ${intent}`);
}
