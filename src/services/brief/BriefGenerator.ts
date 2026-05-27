import { getLLMService, type LLMService } from '@/services/llm';
import { stripJsonFence } from '@/lib/llm/strip-json-fence';
import {
  BRIEF_SYSTEM_PROMPT,
  buildBriefUserMessage,
  type BuildBriefPromptInput,
} from '@/lib/notes/build-brief-prompt';
import { BriefLLMOutputSchema, type BriefLLMOutput } from '@/types/brief';

export const BRIEF_GENERATOR_VERSION = 'llm-v1';
export const BRIEF_GENERATOR_FALLBACK_VERSION = 'llm-v1-fallback-haiku';

export type BriefGenerationResult = {
  brief: BriefLLMOutput;
  generatorVersion: typeof BRIEF_GENERATOR_VERSION | typeof BRIEF_GENERATOR_FALLBACK_VERSION;
  model: 'sonnet' | 'haiku';
  attempts: number;
  /** True if the bedrock service was in stub mode. */
  stub: boolean;
};

/**
 * Prior-Context Brief generator (spec §C + references/prior-context-brief-prompt.md §8).
 *
 * Calls Sonnet (Bedrock) with the brief system prompt + user message. Validates
 * the JSON response against BriefLLMOutputSchema. On schema failure, re-prompts
 * Sonnet ONCE with the validation error appended (the prompt module is
 * deliberately strict; rejections almost always mean the model dropped a key).
 * On a second failure, falls back to Haiku for a thinner-but-valid brief.
 * Stamps generatorVersion accordingly so downstream caches/UIs can show the
 * trust signal in the footer.
 *
 * Stub-mode awareness: the underlying Bedrock service returns a stub JSON
 * envelope when AWS_BEARER_TOKEN_BEDROCK or BEDROCK_MODEL_ID is absent. We
 * detect that envelope ({ stub: true, text: ... }) and synthesize a minimal
 * but VALID brief so the worker still writes a NoteBrief row in dev — the
 * downstream UI can render against it and the precompute pipeline is
 * exercised end-to-end.
 */
export class BriefGenerator {
  constructor(private readonly llm: LLMService = getLLMService()) {}

  /**
   * @param meter Unit 35 — optional cost-rollup metering. The worker
   *   that owns the brief job passes `{ orgId, noteId }`; ad-hoc
   *   callers (tests) can omit it (no log row written; rollup
   *   undercounts).
   */
  async generate(
    input: BuildBriefPromptInput,
    meter?: { orgId: string; noteId?: string },
  ): Promise<BriefGenerationResult> {
    const user = buildBriefUserMessage(input);
    let lastValidationError: string | null = null;

    // Two Sonnet attempts (re-prompt on schema failure).
    for (let attempt = 1; attempt <= 2; attempt++) {
      const augmentedUser = lastValidationError
        ? `${user}\n\nPREVIOUS ATTEMPT FAILED VALIDATION:\n${lastValidationError}\nReturn corrected JSON only.`
        : user;
      const result = await this.llm.generate(BRIEF_SYSTEM_PROMPT, augmentedUser, {
        phi: true,
        temperature: 0,
        jsonMode: true,
        model: 'sonnet',
        maxTokens: 4096,
        ...(meter ? { meter: { ...meter, surface: 'worker.brief.sonnet' } } : {}),
      });
      const parseAttempt = parseBriefOutput(result.text, input);
      if (parseAttempt.ok) {
        return {
          brief: parseAttempt.value,
          generatorVersion: BRIEF_GENERATOR_VERSION,
          model: 'sonnet',
          attempts: attempt,
          stub: !!result.stub,
        };
      }
      lastValidationError = parseAttempt.error;
    }

    // Haiku fallback — single attempt, valid-but-thinner brief.
    const result = await this.llm.generate(BRIEF_SYSTEM_PROMPT, user, {
      phi: true,
      temperature: 0,
      jsonMode: true,
      model: 'haiku',
      maxTokens: 1500,
      ...(meter ? { meter: { ...meter, surface: 'worker.brief.haiku' } } : {}),
    });
    const parseAttempt = parseBriefOutput(result.text, input);
    if (!parseAttempt.ok) {
      throw new Error(
        `BriefGenerator: both Sonnet and Haiku produced invalid output. Last error: ${parseAttempt.error}`,
      );
    }
    return {
      brief: parseAttempt.value,
      generatorVersion: BRIEF_GENERATOR_FALLBACK_VERSION,
      model: 'haiku',
      attempts: 3,
      stub: !!result.stub,
    };
  }
}

type ParseResult =
  | { ok: true; value: BriefLLMOutput }
  | { ok: false; error: string };

/**
 * Parse + validate. In stub mode the bedrock provider returns
 * { stub: true, text: ..., systemPromptChars, userPromptChars } — that's not
 * a valid brief. We detect the envelope and synthesize a minimal-but-valid
 * brief grounded in the input so dev exercises the full pipeline.
 */
function parseBriefOutput(rawText: string, input: BuildBriefPromptInput): ParseResult {
  const stripped = stripJsonFence(rawText);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripped);
  } catch {
    return { ok: false, error: `non-JSON response: ${stripped.slice(0, 120)}` };
  }

  if (
    parsedJson &&
    typeof parsedJson === 'object' &&
    (parsedJson as { stub?: boolean }).stub === true
  ) {
    return { ok: true, value: synthesizeStubBrief(input) };
  }

  const result = BriefLLMOutputSchema.safeParse(parsedJson);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.message.slice(0, 600) };
}

function synthesizeStubBrief(input: BuildBriefPromptInput): BriefLLMOutput {
  const mostRecent = input.priorNotes[input.priorNotes.length - 1];
  const daysAgo = mostRecent
    ? Math.max(0, Math.floor((new Date(input.todayIso).getTime() - new Date(mostRecent.signedAtIso).getTime()) / 86_400_000))
    : 0;

  if (!mostRecent) {
    throw new Error('BriefGenerator stub: cannot synthesize brief with zero prior notes');
  }

  const planSectionContent = mostRecent.finalJson.sections
    .find((s) => /plan/i.test(s.label))
    ?.content?.trim();
  const carryForwardPlan = planSectionContent
    ? planSectionContent
        .split('\n')
        .map((line) => line.replace(/^[-•\s]+/, '').trim())
        .filter((l) => l.length > 0)
        .slice(0, 5)
    : [];

  return {
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
    chiefConcern: '[stub brief — real Bedrock would summarize the chief concern here]',
    priorAssessment: '[stub brief — real Bedrock would extract the prior assessment]',
    trajectory: input.priorNotes.length > 1 ? { summary: '[stub trajectory]', direction: 'mixed' } : null,
    objectiveMeasures: [],
    interventionsPerformed: [],
    homeProgram: null,
    educationGiven: [],
    carryForwardPlan,
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
    // Stub-mode EHR enrichment so the F5 provenance UI is exercisable
    // end-to-end without a real Bedrock call. Maps the projected cache
    // shape directly into the schema's fhirResourceId-keyed entries.
    ehrEnrichment: input.externalEhrContext
      ? {
          activeConditions: input.externalEhrContext.activeConditions.slice(0, 8).map((c) => ({
            display: c.display,
            code: c.code,
            onsetDate: c.onsetDate,
            fhirResourceId: c.provenance.fhirResourceId,
          })),
          currentMedications: input.externalEhrContext.currentMedications.map((m) => ({
            display: m.display,
            status: m.status,
            fhirResourceId: m.provenance.fhirResourceId,
          })),
          allergies: input.externalEhrContext.allergies.map((a) => ({
            display: a.display,
            criticality: a.criticality,
            fhirResourceId: a.provenance.fhirResourceId,
          })),
          recentObservations: input.externalEhrContext.recentObservations.map((o) => ({
            display: o.display,
            value: o.value,
            unit: o.unit,
            effectiveDate: o.effectiveDate,
            fhirResourceId: o.provenance.fhirResourceId,
          })),
        }
      : undefined,
  };
}
