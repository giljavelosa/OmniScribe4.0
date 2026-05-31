import type { LLMService } from '@/services/llm';
import { getLLMService } from '@/services/llm';
import { stripJsonFence } from '@/lib/llm/strip-json-fence';
import { runTool, type AskSource, type Draft } from './tools';
import { RESEARCH_TOOL_NAMES, runResearchTool } from './research-tools';
import { DRAFT_TOOL_NAMES } from './draft-tools';
import { buildPersonaSystemBlock } from './persona';

/**
 * Ask-mode agent runner — Unit 27.
 *
 * Prompt-engineered tool loop. The model emits strict JSON each turn:
 *   - { action: "tool", tool, args }     → run, append result, loop
 *   - { action: "answer", text, sources } → return
 *
 * Bounded by MAX_ITERATIONS so a model that gets stuck calling tools
 * forever is forced into an answer pass (with a "tool budget
 * exhausted" hint appended to the system prompt). Sources MUST be
 * non-empty on a definitive answer; empty-sources answers are
 * surfaced to the UI as clarification questions per the spec.
 *
 * Stub-mode awareness: when the underlying LLMService returns a
 * { stub: true } envelope, the agent returns a canned response
 * immediately without trying to parse tool JSON.
 */

const MAX_ITERATIONS = 4;
/** Unit 31 — think-step ceiling. Bounded independently of MAX_ITERATIONS
 *  so a model that emits many think steps without making tool calls
 *  can't drive audit volume or token cost up indefinitely. Once exceeded,
 *  subsequent think actions are silently dropped (audit + chain ignore
 *  them); the model still gets to call tools + answer. */
const MAX_THINK_STEPS = 5;
/** Per-step summary cap — matches the system prompt's "≤120 chars" rule;
 *  enforced at the parser so a too-long summary is truncated rather than
 *  rejected (model gets the benefit of the doubt — better truncated than
 *  silent retry). */
const MAX_THINK_SUMMARY = 120;

export type AgentRole = 'user' | 'assistant' | 'tool-result';

export type AgentTurn = {
  role: AgentRole;
  content: string;
};

export type AgentMode = 'chart' | 'research';

export type AgentInput = {
  /** Required in chart mode; ignored in research mode (research is
   *  patient-agnostic by design — the agent has no patient context). */
  patientId: string;
  /** Optional in chart mode because patient-cockpit Cleo can answer from
   *  verified uploaded records before the first signed note exists. */
  noteId?: string | null;
  /** Optional — passed through to the model in the system prompt so it
   *  knows which episode to ask about for goal lookups. Chart mode only. */
  episodeId?: string | null;
  history: AgentTurn[];
  question: string;
  /** Unit 29 — 'chart' (default) routes through Unit 27/28 chart tools
   *  + ASK_SYSTEM_PROMPT. 'research' routes through the research tool
   *  set + RESEARCH_SYSTEM_PROMPT. Mode mismatch on a tool call returns
   *  a wrong_mode_tool error so the model can't blend sources. */
  mode?: AgentMode;
};

export type AgentToolCall = {
  tool: string;
  args: unknown;
  resultOk: boolean;
  rowCount: number;
};

export type AgentAnswer = {
  text: string;
  sources: AskSource[];
  /** True when the agent didn't supply sources — UI renders as a
   *  clarification question instead of an answer. */
  isClarification: boolean;
  /** Phase 1B — research-mode-only fallback. True when the model
   *  emitted `{ action: 'answer-from-knowledge' }` after exhausting
   *  the vetted-literature corpus. The UI must render a yellow
   *  "LLM knowledge" badge above the bubble AND a yellow
   *  llm-intrinsic source pill so the clinician sees the trust
   *  framing twice. Chart mode never sets this true (fail-closed). */
  isLLMKnowledge: boolean;
};

export type ReasoningStep = {
  /** 1-based index in the chain. Useful for the UI render + the audit
   *  metadata; also lets the model self-reference ("as I noted in step 2"
   *  on a later iteration if it wants — not enforced). */
  index: number;
  /** Cap-enforced ≤ 120 chars by the parser. */
  summary: string;
};

export type AgentOutput = {
  answer: AgentAnswer;
  toolCalls: AgentToolCall[];
  /** Unit 30 — drafts produced by `draftPatientMessage`,
   *  `proposeFollowUpCadence`, or `suggestReferralLetterContent` tool
   *  calls during this run. Empty when no draft tools fired. The chat
   *  surface renders each as a DraftCard with Accept / Edit / Discard
   *  actions; the API route audits PROPOSED for each. */
  drafts: Draft[];
  /** Unit 31 — chain-of-thought steps the model emitted between tool
   *  calls or before the final answer. Empty when the model went
   *  straight to tools + answer. Bounded by MAX_THINK_STEPS. */
  reasoningSteps: ReasoningStep[];
  iterations: number;
  stub: boolean;
};

export type AgentContext = {
  orgId: string;
};

export const ASK_SYSTEM_PROMPT = `
You are a clinical co-pilot answering a clinician's question about a specific
patient during their visit. You have access to read-only lookup tools:

  In-app (always available):
  - lookupSignedNote({ noteId })             → returns sections + signedAt
  - lookupFollowUp({ patientId, status? })   → returns up to 10 follow-ups
  - lookupEpisodeGoals({ episodeId })        → returns active goals for ONE episode
  - lookupPatientGoals({ patientId })        → returns active goals across ALL of the patient's episodes (use when episodeId is none or when you want a cross-episode answer)
  - lookupPatientDemographics({ patientId }) → returns name, dob, sex, mrn
  - lookupVerifiedExternalContext({ patientId, documentType?, query?, pageNumber? })
      → returns clinician-verified uploaded documents only (Rule 20: DOCUMENT rows require verifiedAt)
  - lookupMedicationReference({ medicationName })
      → returns general medication-reference dosing/safety facts. Pass ONLY the medication name, never patient identifiers.

If the context block says noteId is "(none)", do not call lookupSignedNote or
draft/action tools that require a noteId. Use patient-scoped tools such as
lookupPatientDemographics, lookupPatientGoals, lookupFollowUp, verified
document lookup, and FHIR tools instead.

  EHR-backed (require a verified patient-to-EHR link — Rule 20):
  - lookupFhirCondition({ patientId, clinicalStatus? })
  - lookupFhirMedication({ patientId, status? })
  - lookupFhirObservation({ patientId, code? })
  - lookupFhirAllergy({ patientId })
  - lookupFhirCarePlan({ patientId })

SEARCH STRATEGY. A clinical value (a vital, a measure, a count) is not only in FHIR —
goals carry current/target measures, the visit note carries vitals, follow-ups carry
committed checks. For a clinical-value question, check the relevant in-app tools too,
not just the FHIR one.

For labs, medications, allergies, diagnoses/problems, procedures, imaging, transplant
history, CVA history, or rehab function, verified uploaded documents are first-class
chart sources. Call lookupVerifiedExternalContext before concluding the value is absent
from the chart. Do NOT answer "not found" from the signed visit note alone when a
verified uploaded document tool result is available.

When a FHIR tool returns { error: "verified_link_required" }, the patient has no
verified EHR link — FHIR is unavailable, but the in-app tools still work. Do NOT make
"go link an EHR" your answer. Instead:
  - First try the relevant in-app tools (lookupPatientGoals / lookupEpisodeGoals,
    lookupFollowUp, lookupSignedNote). If one answers the question, answer from it and
    cite it (kind: "note" | "goal" | "follow-up").
  - If no in-app source has the answer, give an honest, definitive answer naming what
    you checked — e.g. "I don't see any blood-pressure readings in this patient's
    visit notes or goals here." Attach { kind: "patient", id: <patientId>,
    label: "Confirm EHR link" } as a source so the answer stays definitive and the
    clinician keeps the option to link an EHR. You MAY add one short sentence that
    linking an EHR would surface that data — as a secondary note, never the whole answer.

When a FHIR tool returns { error: "fhir_rate_limit_exceeded" }, answer with
what you already have and tell the clinician you've hit the session lookup
budget for EHR data.

Sources for FHIR-derived facts use { kind: "fhir", id: <fhirResourceId>, label }.
Sources from verified uploaded documents use { kind: "document", id: <externalContextId>, label }.
Sources from medication-reference tools use { kind: "literature", id: <sourceId>, label }.

PATIENT-CONTEXT REFERENCE QUESTIONS.
When the clinician asks a question that combines this patient's context with
general medical reference material, such as "given his age, what is the usual
losartan dose?", do this in Chart mode:
  - First load the relevant patient facts with chart tools. Usually call
    lookupPatientDemographics and, when the question touches kidney function,
    allergies, meds, diagnoses, or labs, use verified documents/FHIR/in-app
    sources as needed.
  - Then call lookupMedicationReference with the medication name only.
  - Answer by clearly separating "Patient context I found" from "General
    reference guidance." Cite at least one patient/chart source and the
    medication-reference source.
  - Do NOT say "start", "change", or "recommend" a medication for the patient
    unless that instruction already exists in a chart source. Phrase as
    reference guidance for clinician review.

═══ ACTION TOOLS — produce a draft, clinician confirms ═══

You ALSO have access to draft-producing tools. These do NOT mutate any
record by themselves — they return a draft the clinician will confirm via
a DraftCard in the UI. Use them when the clinician asks you to CREATE,
DRAFT, PROPOSE, SCHEDULE, SET, or WRITE something.

  - draftPatientMessage({ patientId, noteId, topic? })
      → drafts a short plain-language patient message
  - proposeFollowUpCadence({ patientId, noteId })
      → drafts a follow-up commitment for the next visit
      ← use this when the clinician says any of:
         "create a follow-up plan", "draft a follow-up", "set a follow-up",
         "schedule a recheck", "recheck X next visit", "add to next visit",
         "check Y at the next visit", "follow up in N weeks/days/months"
  - suggestReferralLetterContent({ patientId, noteId, specialty? })
      → drafts a brief referral letter

ACTION TOOL RULES (read these carefully):

1. When the clinician's question is clearly an action request (verbs like
   "create / draft / propose / write / schedule / set / add for next visit"),
   call the matching action tool IMMEDIATELY. Do NOT run read lookups first
   — the action tool already loads the patient context internally.

2. After the action tool returns, give a SHORT answer (1 sentence) that
   tells the clinician the draft is ready below and to review and confirm
   it. Sources are NOT required for action-tool answers — pass an empty
   sources array (just []). The DraftCard renders separately in the UI.

3. NEVER refuse an action request with "I need more information" or
   "I couldn't gather enough information" when the clinician's intent is
   clear. Call the appropriate draft tool; the tool does its own context
   loading.

EXAMPLE — action-mode flow (do this exactly):

  User: "create a follow-up plan: check ROM next visit"
  You:  { "action": "tool",
          "tool": "proposeFollowUpCadence",
          "args": { "patientId": "<from context>", "noteId": "<from context>" } }
  Tool: { draft: { kind: "followup-cadence", content: "Recheck ROM next visit.",
                   draftId: "..." }, ... }
  You:  { "action": "answer",
          "text": "Drafted a follow-up — review and tap Accept to add it.",
          "sources": [] }

═══ ABSOLUTE RULES ═══

1. SOURCE-GROUNDED ONLY.
   Every claim in your answer must be supported by data returned from a tool
   call this session. NEVER invent. NEVER cite a note id you weren't given by
   the tools.

2. NO CLINICAL RECOMMENDATIONS BEYOND THE SOURCE.
   You may surface what a prior note said about the plan; you may NOT add a
   diagnosis, precaution, or recommendation that isn't already in the source.

3. SHORT, FACTUAL, SCANNABLE.
   The clinician is mid-visit. Answer in 1-3 sentences. No prose padding.

═══ OUTPUT FORMAT (strict JSON, nothing else) ═══

To call a tool:
  { "action": "tool", "tool": "<name>", "args": { ... } }

To give a definitive answer:
  { "action": "answer", "text": "<short answer>", "sources": [
      { "kind": "note" | "follow-up" | "goal" | "patient" | "fhir" | "document" | "literature",
        "id": "<id>",
        "label": "<short human label>" } ] }

To ask the clinician a clarifying question (when you can't answer):
  { "action": "answer", "text": "<your question>", "sources": [] }

═══ REASONING — Unit 31 ═══

Before a tool call OR before your final answer, you MAY emit ONE
"think" step:
  { "action": "think", "summary": "<your working hypothesis, ≤120 chars>" }

Think steps are visible to the clinician (collapsible chain under the
answer). Use them sparingly — 1-3 per answer is plenty. Each summary
MUST be 120 characters or fewer. NEVER include patient identifiers
(names, MRNs, DOBs) or any other PHI in think summaries.

If you don't need to think, skip straight to a tool call or answer.

The very first character of every response is { and the very last is }.
`.trim();

export const RESEARCH_SYSTEM_PROMPT = `
You are a clinical research assistant. The clinician is asking about evidence
in the medical literature — NOT about a specific patient. You have NO access
to any patient's chart in this mode; do not reference patient data.

You have access to TWO research lookup tools:

  - searchPMC({ query, limit? })                  → PubMed Central
  - searchAttestedLiterature({ query, limit? })   → vetted clinical corpus

═══ ABSOLUTE RULES ═══

1. EVIDENCE SUMMARIES, NOT RECOMMENDATIONS.
   Surface what the literature says about a topic. Do NOT prescribe, diagnose,
   or recommend for a specific patient. The clinician decides whether the
   evidence applies.

2. CITE EVERY CLAIM — when you use { "action": "answer" }.
   Every fact in an "answer" must cite at least one entry from a tool result
   via the sources array. Use kind: "literature" with the source id (PMC id
   or attested-literature id) and a short citation label like
   "Smith 2024 (NEJM)".

   EXCEPTION — when the literature tools came up empty or returned stub
   abstracts that don't address the question, do NOT force a literature
   citation onto an answer that isn't actually from those sources. Use the
   "answer-from-knowledge" action instead (defined below). The UI labels
   that path so the clinician sees the trust signal clearly.

3. NO PATIENT-SPECIFIC TAILORING.
   If the clinician asks "should I prescribe X for my patient?" answer with
   "I can't answer questions about specific patients in research mode — switch
   to the Chart tab for that. The literature on X says: …" and use a single
   { kind: "literature", id, label } source for the evidence summary.

═══ OUTPUT FORMAT (strict JSON, nothing else) ═══

To call a tool:
  { "action": "tool", "tool": "<name>", "args": { ... } }

To answer:
  { "action": "answer", "text": "<short evidence summary>", "sources": [
      { "kind": "literature", "id": "<PMC or lit id>",
        "label": "<Author Year (Journal)>" } ] }

═══ REASONING — Unit 31 ═══

Before a tool call OR before your final answer, you MAY emit ONE
"think" step:
  { "action": "think", "summary": "<your working hypothesis, ≤120 chars>" }

Think steps are visible to the clinician (collapsible chain under the
answer). Use them sparingly — 1-3 per answer is plenty. Each summary
MUST be 120 characters or fewer.

If you don't need to think, skip straight to a tool call or answer.

═══ FALLBACK TO TRAINING KNOWLEDGE — Research mode only ═══

The literature corpus is intentionally narrow today (stub PMC + a
limited attested set). When the literature tools don't surface what
the clinician actually needs, you MUST take the fallback path:

  { "action": "answer-from-knowledge",
    "text": "<your best general-medical-knowledge answer>",
    "topic": "<short topic, e.g. 'tirzepatide starting dose'>" }

Trigger conditions (any one is enough — DO NOT keep searching once
you see one of these):
  - A literature tool returned 0 results.
  - The returned abstracts begin with "[stub]" — that means the
    real corpus isn't wired yet and you're seeing placeholder data.
  - The returned papers are tangentially related but don't actually
    answer the specific question (e.g. clinician asks "starting dose
    for X" and the citations are about long-term outcomes).

DO NOT:
  - Tell the clinician the corpus is "stubbed", "in development",
    "pending integration", or that "once the real PMC feeds are live
    I'll be able to…". That's OUR concern, not theirs. They asked a
    clinical question and they want the answer.
  - Return { "action": "answer" } with literature pills when the
    cited papers don't actually contain what you're asserting — the
    pills mislead the clinician about what's in the source.
  - Use the clarification path ({ "action": "answer", sources: [] })
    just because you have nothing literature-cited to say. Research
    mode has the answer-from-knowledge escape valve for exactly this
    case.

The clinician's UI labels every answer-from-knowledge response TWICE:
a yellow "LLM knowledge" badge above the bubble AND a yellow
llm-intrinsic source pill. The trust framing is visible; the
clinician knows the answer isn't literature-cited and expects a
useful answer anyway.

Patient-specific advice is still off-limits — Research mode is
patient-agnostic by design, regardless of which action you use.

The very first character of every response is { and the very last is }.
`.trim();

export async function runAgent(
  input: AgentInput,
  ctx: AgentContext,
  llm: LLMService = getLLMService(),
): Promise<AgentOutput> {
  const toolCalls: AgentToolCall[] = [];
  // Unit 30 — drafts produced by action tools accumulate here. The
  // route returns them in the response so the chat surface can render
  // each as a DraftCard with Accept / Edit / Discard.
  const drafts: Draft[] = [];
  // Unit 31 — chain-of-thought steps the model emits between tool
  // calls or before the final answer. Bounded by MAX_THINK_STEPS; once
  // exceeded, additional think actions are silently dropped from the
  // chain (audit + chain ignore them, but the model can still call
  // tools + answer).
  const reasoningSteps: ReasoningStep[] = [];
  // Build the conversation transcript the model sees on each turn.
  const turns: AgentTurn[] = [
    ...input.history,
    { role: 'user', content: input.question },
  ];
  // Unit 28 — per-session FHIR row budget. Mutated by reference inside
  // each FHIR tool. Initialized here so the budget is per-runAgent-call
  // (NOT global; a new ask starts fresh). Non-FHIR tools (Unit 27)
  // ignore the field.
  const toolCtx = { orgId: ctx.orgId, fhirRowsConsumed: { count: 0 } };
  // Unit 29 — mode dispatch picks the system prompt + locks the tool
  // dispatcher to one half of the registry. Cross-mode tool calls
  // return wrong_mode_tool — fail-closed against the model blending
  // chart + research sources.
  const mode: AgentMode = input.mode ?? 'chart';
  // Unit 42 / Phase 2 — prepend the Miss Cleo persona block at call
  // time so the exported ASK_SYSTEM_PROMPT / RESEARCH_SYSTEM_PROMPT
  // constants remain stable (existing agent tests assert against
  // their substrings). The persona block owns voice + anti-drift;
  // the existing prompts own the tool catalog + OUTPUT FORMAT contract.
  const baseSystemPrompt = mode === 'research' ? RESEARCH_SYSTEM_PROMPT : ASK_SYSTEM_PROMPT;
  const systemPrompt = `${buildPersonaSystemBlock(mode)}\n\n${baseSystemPrompt}`;
  let stub = false;
  let iterations = 0;

  let preloadedVerifiedDocuments: VerifiedExternalContextToolData | null = null;
  if (mode === 'chart' && shouldPreloadVerifiedExternalContext(input.question)) {
    const requestedPageNumber = requestedDocumentPageNumber(input.question);
    const lookupArgs = {
      patientId: input.patientId,
      query: input.question,
      ...(requestedPageNumber ? { pageNumber: requestedPageNumber } : {}),
    };
    const toolResult = await runTool(
      'lookupVerifiedExternalContext',
      lookupArgs,
      toolCtx,
    );
    toolCalls.push({
      tool: 'lookupVerifiedExternalContext',
      args: lookupArgs,
      resultOk: toolResult.ok,
      rowCount: toolResult.ok ? toolResult.rowCount : 0,
    });
    if (toolResult.ok) {
      preloadedVerifiedDocuments = coerceVerifiedExternalContextToolData(toolResult.data);
    }
    turns.push({
      role: 'tool-result',
      content: JSON.stringify({
        tool: 'lookupVerifiedExternalContext',
        result: toolResult.ok ? toolResult.data : { error: toolResult.error },
      }),
    });
  }

  const deterministicPageAnswer = maybeAnswerVerifiedDocumentPageRequest(
    input.question,
    preloadedVerifiedDocuments,
  );
  if (deterministicPageAnswer) {
    return {
      answer: deterministicPageAnswer,
      toolCalls,
      drafts,
      reasoningSteps,
      iterations,
      stub,
    };
  }

  const deterministicVerifiedDocumentAnswer = maybeAnswerVerifiedDocumentQuestion(
    input.question,
    preloadedVerifiedDocuments,
  );
  if (deterministicVerifiedDocumentAnswer) {
    return {
      answer: deterministicVerifiedDocumentAnswer,
      toolCalls,
      drafts,
      reasoningSteps,
      iterations,
      stub,
    };
  }

  // Phase 1A — refund the iteration the first time a parse fails so a
  // single JSON-mode hiccup (e.g. an unexpected markdown fence the
  // fence-stripper missed) doesn't tax the model's tool budget. Capped
  // at 1 so a model that keeps emitting non-JSON can't hang the loop.
  let parseRetriesUsed = 0;
  while (iterations < MAX_ITERATIONS) {
    iterations += 1;
    const userPrompt = buildUserPrompt(input, turns, iterations === MAX_ITERATIONS, mode);
    const result = await llm.generate(systemPrompt, userPrompt, {
      phi: true,
      temperature: 0,
      jsonMode: true,
      model: 'sonnet',
      maxTokens: 800,
      // Unit 35 — cost rollup metering. Surface tag distinguishes
      // chart vs research mode so the owner can see the split.
      meter: {
        orgId: ctx.orgId,
        noteId: input.noteId || undefined,
        surface: mode === 'research' ? 'copilot.research' : 'copilot.ask',
      },
    });
    stub = !!result.stub;
    if (stub) {
      return {
        answer: {
          text: 'Ask mode runs against Bedrock — set AWS_BEARER_TOKEN_BEDROCK + BEDROCK_MODEL_ID to use it in real mode.',
          sources: [],
          isClarification: true,
          isLLMKnowledge: false,
        },
        toolCalls,
        drafts,
        reasoningSteps,
        iterations,
        stub,
      };
    }

    const parsed = parseModelOutput(result.text);
    if (!parsed.ok) {
      // Phase 1A — refund the very first parse failure per run so the
      // model gets one real retry instead of losing 25% of its tool
      // budget to a malformed JSON envelope. Subsequent parse failures
      // are iteration-consuming so a stuck model still terminates.
      if (parseRetriesUsed < 1) {
        parseRetriesUsed += 1;
        iterations -= 1;
      }
      turns.push({
        role: 'tool-result',
        content: `previous response failed validation: ${parsed.error}. Return strict JSON.`,
      });
      continue;
    }

    // Unit 31 — "think" is a free intra-step annotation while the
    // chain has budget. We append it, echo it back into the prompt
    // history, and refund the iteration so the model can still spend
    // the full MAX_ITERATIONS on actual tools + answer.
    //
    // Once MAX_THINK_STEPS is hit, additional think actions are
    // treated as iteration-consuming no-ops — the chain stops growing,
    // we don't echo (the model already sees its prior think turns),
    // and we DO let the iteration counter decrement so a misbehaving
    // model that only emits think can't hang the loop.
    if (parsed.value.action === 'think') {
      if (reasoningSteps.length < MAX_THINK_STEPS) {
        reasoningSteps.push({
          index: reasoningSteps.length + 1,
          summary: parsed.value.summary,
        });
        turns.push({
          role: 'assistant',
          content: JSON.stringify({ action: 'think', summary: parsed.value.summary }),
        });
        // Refund — think is free per spec decision 1.
        iterations -= 1;
      } else {
        // Budget exhausted; nudge the model toward tools/answer.
        turns.push({
          role: 'tool-result',
          content: 'reasoning chain full (max 5 think steps). Next response MUST be a tool call or final answer.',
        });
      }
      continue;
    }

    if (parsed.value.action === 'tool') {
      const toolName = parsed.value.tool;
      const isResearchTool = RESEARCH_TOOL_NAMES.has(toolName);
      // Cross-mode gate — fail-closed against blended sources.
      let toolResult;
      if (mode === 'research' && !isResearchTool) {
        toolResult = {
          ok: false as const,
          error: `wrong_mode_tool:${toolName}_is_chart_only`,
        };
      } else if (mode === 'chart' && isResearchTool) {
        toolResult = {
          ok: false as const,
          error: `wrong_mode_tool:${toolName}_is_research_only`,
        };
      } else if (isResearchTool) {
        toolResult = await runResearchTool(toolName, parsed.value.args);
      } else {
        toolResult = await runTool(toolName, parsed.value.args, toolCtx);
      }
      toolCalls.push({
        tool: parsed.value.tool,
        args: parsed.value.args,
        resultOk: toolResult.ok,
        rowCount: toolResult.ok ? toolResult.rowCount : 0,
      });
      // Unit 30 — surface drafts as they're produced. The draft tool's
      // data shape carries `{ draft, contextSummary, sourceNoteId }`;
      // we pull the draft for the route to return + leave the model
      // to reference it in its assistant text.
      if (toolResult.ok && DRAFT_TOOL_NAMES.has(toolName)) {
        const data = toolResult.data as { draft?: Draft } | null;
        if (data?.draft) drafts.push(data.draft);
      }
      turns.push({
        role: 'tool-result',
        content: JSON.stringify({
          tool: parsed.value.tool,
          result: toolResult.ok ? toolResult.data : { error: toolResult.error },
        }),
      });
      continue;
    }

    // Phase 1B — research-only LLM-knowledge fallback.
    // Chart mode rejects with a wrong_mode_fallback tool-result and
    // keeps looping so the model is forced back into the
    // tool/answer/clarification flow. Research mode converts the
    // action into an AgentAnswer with `isLLMKnowledge: true` plus a
    // synthetic `llm-intrinsic` source pill.
    if (parsed.value.action === 'answer-from-knowledge') {
      if (mode === 'chart') {
        turns.push({
          role: 'tool-result',
          content: JSON.stringify({
            tool: 'answer-from-knowledge',
            result: { error: 'wrong_mode_fallback:answer-from-knowledge_is_research_only' },
          }),
        });
        continue;
      }
      return {
        answer: {
          text: parsed.value.text,
          sources: [
            { kind: 'llm-intrinsic', id: 'sonnet-4-5', label: 'LLM training knowledge' },
          ],
          isClarification: false,
          isLLMKnowledge: true,
        },
        toolCalls,
        drafts,
        reasoningSteps,
        iterations,
        stub,
      };
    }

    // action === 'answer'
    const sources = parsed.value.sources ?? [];
    const correctedLabAnswer = maybeCorrectVerifiedDocumentLabFalseNegative(
      input.question,
      parsed.value.text,
      preloadedVerifiedDocuments,
    );
    if (correctedLabAnswer) {
      return {
        answer: correctedLabAnswer,
        toolCalls,
        drafts,
        reasoningSteps,
        iterations,
        stub,
      };
    }
    return {
      answer: {
        text: parsed.value.text,
        sources,
        isClarification: sources.length === 0,
        isLLMKnowledge: false,
      },
      toolCalls,
      drafts,
      reasoningSteps,
      iterations,
      stub,
    };
  }

  // Max iterations hit without an answer. Return a graceful fallback.
  return {
    answer: {
      text: "I couldn't gather enough information to answer that in the available tool budget. Try rephrasing or asking a more specific question.",
      sources: [],
      isClarification: true,
      isLLMKnowledge: false,
    },
    toolCalls,
    drafts,
    reasoningSteps,
    iterations,
    stub,
  };
}

type VerifiedExternalContextToolData = {
  documents: Array<{
    id: string;
    dateOfRecord: string;
    sourceLabel: string | null;
    documentType: string;
    summary: string;
    diagnoses: Array<{
      text: string;
      icdHint: string | null;
      status: string;
      sourcePage: number;
      confidence: string;
    }>;
    medications: Array<{
      name: string;
      dose: string | null;
      route: string | null;
      frequency: string | null;
      status: string;
      sourcePage: number;
      confidence: string;
    }>;
    allergies: Array<{
      substance: string;
      reaction: string | null;
      severity: string | null;
      sourcePage: number;
      confidence: string;
    }>;
    labs: Array<{
      name: string;
      value: string;
      unit: string | null;
      referenceRange: string | null;
      abnormalFlag: string | null;
      collectedDate: string | null;
      sourcePage: number;
      confidence: string;
    }>;
    textMatches?: Array<{
      term: string;
      sourcePage: number | null;
      text: string;
    }>;
    pages?: Array<{
      fileIndex: number;
      pageNumber: number;
      text: string;
      characterCount: number;
    }>;
    procedures?: Array<{
      text: string;
      date: string | null;
      sourcePage: number;
      confidence: string;
    }>;
  }>;
};

export function shouldPreloadVerifiedExternalContext(question: string): boolean {
  return /\b(page|pages|ocr|searchable|scanned|scan|lab|labs|laboratory|creatinine|egfr|eGFR|a1c|hgb|hemoglobin|magnesium|tacrolimus|trough|glucose|allerg|medication|medications|meds|dose|dosing|renal|kidney|ckd|diagnos|problem|procedure|imaging|x-ray|ct|mri|transplant|cva|stroke|rehab|physical therapy|occupational therapy|pt|ot|uploaded|document|outside record)\b/i
    .test(question);
}

function coerceVerifiedExternalContextToolData(data: unknown): VerifiedExternalContextToolData | null {
  if (!data || typeof data !== 'object') return null;
  const documents = (data as { documents?: unknown }).documents;
  if (!Array.isArray(documents)) return null;
  return { documents: documents as VerifiedExternalContextToolData['documents'] };
}

function maybeAnswerVerifiedDocumentQuestion(
  question: string,
  data: VerifiedExternalContextToolData | null,
): AgentAnswer | null {
  if (!data || data.documents.length === 0) return null;
  if (isLabQuestion(question)) return answerVerifiedDocumentLabQuestion(question, data);
  if (isMedicationQuestion(question)) return answerVerifiedDocumentMedicationQuestion(question, data);
  if (isAllergyQuestion(question)) return answerVerifiedDocumentAllergyQuestion(data);
  if (isDiagnosisQuestion(question)) return answerVerifiedDocumentDiagnosisQuestion(data);
  if (isProcedureOrRehabQuestion(question)) return answerVerifiedDocumentProcedureQuestion(data);
  if (isPresenceQuestion(question)) return answerVerifiedDocumentPresenceQuestion(question, data);
  return null;
}

function answerVerifiedDocumentLabQuestion(
  question: string,
  data: VerifiedExternalContextToolData,
): AgentAnswer | null {
  const match = findRequestedVerifiedLab(question, data);
  if (match) {
    const snippet = findSnippetForLab(match.document, match.lab.name);
    const enriched = enrichLabFromSnippet(match.lab, snippet);
    const value = [match.lab.value, enriched.unit].filter(Boolean).join(' ');
    const date = enriched.collectedDate ?? match.lab.collectedDate ?? match.document.dateOfRecord;
    const flag = enriched.abnormalFlag && enriched.abnormalFlag !== 'normal'
      ? `, flagged ${enriched.abnormalFlag}`
      : '';
    const range = enriched.referenceRange ? ` (reference range ${enriched.referenceRange})` : '';
    const sourcePage = enriched.sourcePage ?? match.lab.sourcePage;
    return {
      text: `${match.lab.name} was ${value}${flag}${range}, collected ${date} in the verified uploaded document, page ${sourcePage}.`,
      sources: [documentSource(match.document, sourcePage)],
      isClarification: false,
      isLLMKnowledge: false,
    };
  }

  const pageTextMatch = findRequestedLabValueInVerifiedPageText(question, data);
  if (pageTextMatch) {
    const flag = pageTextMatch.flag ? `, flagged ${pageTextMatch.flag}` : '';
    const range = pageTextMatch.referenceRange ? ` (reference range ${pageTextMatch.referenceRange})` : '';
    const date = pageTextMatch.collectedDate
      ? `, collected ${pageTextMatch.collectedDate}`
      : '';
    return {
      text: `${pageTextMatch.name} was ${pageTextMatch.value}${pageTextMatch.unit ? ` ${pageTextMatch.unit}` : ''}${flag}${range}${date} in the verified uploaded document, page ${pageTextMatch.sourcePage}.`,
      sources: [documentSource(pageTextMatch.document, pageTextMatch.sourcePage)],
      isClarification: false,
      isLLMKnowledge: false,
    };
  }

  const labs = data.documents.flatMap((document) =>
    document.labs.map((lab) => ({ document, lab })),
  );
  if (labs.length === 0) return answerFromDocumentSnippets(question, data, 'I found lab-related verified document text, but no structured lab values were extracted.');
  const lines = labs.slice(0, 8).map(({ lab }) => {
    const value = [lab.value, lab.unit].filter(Boolean).join(' ');
    const flag = lab.abnormalFlag && lab.abnormalFlag !== 'normal' ? ` (${lab.abnormalFlag})` : '';
    return `- ${lab.name}: ${value}${flag}, page ${lab.sourcePage}`;
  });
  return {
    text: `Verified uploaded records list these lab values:\n${lines.join('\n')}`,
    sources: [documentSource(labs[0]!.document, labs[0]!.lab.sourcePage)],
    isClarification: false,
    isLLMKnowledge: false,
  };
}

function answerVerifiedDocumentMedicationQuestion(
  question: string,
  data: VerifiedExternalContextToolData,
): AgentAnswer | null {
  const terms = clinicalQueryTermsForAgent(question);
  const genericMedicationTerms = new Set([
    'medication',
    'medications',
    'medicine',
    'medicines',
    'med',
    'meds',
    'drug',
    'drugs',
    'dose',
    'dosing',
    'listed',
    'current',
    'uploaded',
    'record',
    'records',
    'packet',
    'document',
    'documents',
    'outside',
  ]);
  const specificTerms = terms.filter((term) => !genericMedicationTerms.has(term));
  const meds = data.documents.flatMap((document) =>
    document.medications
      .filter((med) =>
        terms.length === 0 ||
        terms.some((term) => {
          const normalizedName = normalizeClinicalText(med.name);
          const sig = normalizeClinicalText([med.dose, med.route, med.frequency].filter(Boolean).join(' '));
          return normalizedName.includes(term) || sig.includes(term);
        }),
      )
      .map((med) => ({ document, med })),
  );
  if (specificTerms.length > 0 && meds.length === 0) {
    return answerFromSpecificDocumentSnippets(
      data,
      specificTerms,
      'I found medication-related verified document text that matches the requested item.',
    ) ?? answerVerifiedDocumentNoMatch(data);
  }
  const selected = meds.length > 0
    ? meds
    : data.documents.flatMap((document) =>
        document.medications.map((med) => ({ document, med })),
      );
  if (selected.length === 0) {
    return specificTerms.length > 0
      ? answerFromSpecificDocumentSnippets(
        data,
        specificTerms,
        'I found medication-related verified document text that matches the requested item.',
      ) ?? answerVerifiedDocumentNoMatch(data)
      : answerFromDocumentSnippets(question, data, 'I found medication-related verified document text, but no structured medication list was extracted.');
  }
  const lines = selected.slice(0, 12).map(({ med }) => {
    const sig = [med.dose, med.route, med.frequency].filter(Boolean).join(' ');
    return `- ${med.name}${sig ? ` ${sig}` : ''} — ${med.status}, page ${med.sourcePage}`;
  });
  return {
    text: `Verified uploaded records list these medications:\n${lines.join('\n')}`,
    sources: [documentSource(selected[0]!.document, selected[0]!.med.sourcePage)],
    isClarification: false,
    isLLMKnowledge: false,
  };
}

function answerVerifiedDocumentAllergyQuestion(
  data: VerifiedExternalContextToolData,
): AgentAnswer | null {
  const allergies = data.documents.flatMap((document) =>
    document.allergies.map((allergy) => ({ document, allergy })),
  );
  if (allergies.length === 0) return null;
  const lines = allergies.slice(0, 10).map(({ allergy }) => {
    const detail = [allergy.reaction, allergy.severity ? `${allergy.severity} severity` : null]
      .filter(Boolean)
      .join('; ');
    return `- ${allergy.substance}${detail ? ` — ${detail}` : ''}, page ${allergy.sourcePage}`;
  });
  return {
    text: `Verified uploaded records document these allergies or safety items:\n${lines.join('\n')}`,
    sources: [documentSource(allergies[0]!.document, allergies[0]!.allergy.sourcePage)],
    isClarification: false,
    isLLMKnowledge: false,
  };
}

function answerVerifiedDocumentDiagnosisQuestion(
  data: VerifiedExternalContextToolData,
): AgentAnswer | null {
  const diagnoses = data.documents.flatMap((document) =>
    document.diagnoses.map((diagnosis) => ({ document, diagnosis })),
  );
  if (diagnoses.length === 0) return null;
  const lines = diagnoses.slice(0, 12).map(({ diagnosis }) => {
    const code = diagnosis.icdHint ? ` (${diagnosis.icdHint})` : '';
    return `- ${diagnosis.text}${code} — ${diagnosis.status}, page ${diagnosis.sourcePage}`;
  });
  return {
    text: `Verified uploaded records list these diagnoses or problems:\n${lines.join('\n')}`,
    sources: [documentSource(diagnoses[0]!.document, diagnoses[0]!.diagnosis.sourcePage)],
    isClarification: false,
    isLLMKnowledge: false,
  };
}

function answerVerifiedDocumentProcedureQuestion(
  data: VerifiedExternalContextToolData,
): AgentAnswer | null {
  const procedures = data.documents.flatMap((document) =>
    (document.procedures ?? []).map((procedure) => ({ document, procedure })),
  );
  if (procedures.length === 0) return null;
  const lines = procedures.slice(0, 10).map(({ procedure }) =>
    `- ${procedure.text}${procedure.date ? ` (${procedure.date})` : ''}, page ${procedure.sourcePage}`,
  );
  return {
    text: `Verified uploaded records include these procedures, imaging, or rehab findings:\n${lines.join('\n')}`,
    sources: [documentSource(procedures[0]!.document, procedures[0]!.procedure.sourcePage)],
    isClarification: false,
    isLLMKnowledge: false,
  };
}

function answerVerifiedDocumentPresenceQuestion(
  question: string,
  data: VerifiedExternalContextToolData,
): AgentAnswer | null {
  const snippets = data.documents.flatMap((document) =>
    (document.textMatches ?? []).map((match) => ({ document, match })),
  );
  if (snippets.length > 0) {
    return answerFromDocumentSnippets(question, data, 'Verified uploaded records contain matching source text.');
  }
  const document = data.documents[0]!;
  return answerVerifiedDocumentNoMatch(data, document);
}

function answerVerifiedDocumentNoMatch(
  data: VerifiedExternalContextToolData,
  fallbackDocument: VerifiedExternalContextToolData['documents'][number] | null = null,
): AgentAnswer | null {
  const document = fallbackDocument ?? data.documents[0];
  if (!document) return null;
  return {
    text: `I did not find matching text for that item in the verified uploaded documents I checked. This answer is limited to clinician-verified uploaded document text currently indexed for this patient.`,
    sources: [documentSource(document, null)],
    isClarification: false,
    isLLMKnowledge: false,
  };
}

function answerFromSpecificDocumentSnippets(
  data: VerifiedExternalContextToolData,
  requiredTerms: string[],
  lead: string,
): AgentAnswer | null {
  const normalizedTerms = requiredTerms
    .map((term) => normalizeClinicalText(term))
    .filter((term) => term.length >= 3);
  if (normalizedTerms.length === 0) return null;
  const snippets = data.documents.flatMap((document) =>
    (document.textMatches ?? [])
      .filter((match) => {
        const text = normalizeClinicalText(match.text);
        return normalizedTerms.some((term) => text.includes(term));
      })
      .map((match) => ({ document, match })),
  );
  if (snippets.length === 0) return null;
  const lines = snippets.slice(0, 3).map(({ match }) => {
    const page = match.sourcePage ? `page ${match.sourcePage}` : 'uploaded document';
    return `- ${page}: ${clipOneLine(match.text, 420)}`;
  });
  const first = snippets[0]!;
  return {
    text: `${lead}\n${lines.join('\n')}`,
    sources: [documentSource(first.document, first.match.sourcePage)],
    isClarification: false,
    isLLMKnowledge: false,
  };
}

function answerFromDocumentSnippets(
  _question: string,
  data: VerifiedExternalContextToolData,
  lead: string,
): AgentAnswer | null {
  const snippets = data.documents.flatMap((document) =>
    (document.textMatches ?? []).map((match) => ({ document, match })),
  );
  if (snippets.length === 0) return null;
  const lines = snippets.slice(0, 3).map(({ match }) => {
    const page = match.sourcePage ? `page ${match.sourcePage}` : 'uploaded document';
    return `- ${page}: ${clipOneLine(match.text, 420)}`;
  });
  const first = snippets[0]!;
  return {
    text: `${lead}\n${lines.join('\n')}`,
    sources: [documentSource(first.document, first.match.sourcePage)],
    isClarification: false,
    isLLMKnowledge: false,
  };
}

function documentSource(
  document: VerifiedExternalContextToolData['documents'][number],
  pageNumber: number | null,
) {
  return {
    kind: 'document' as const,
    id: document.id,
    label: `${document.sourceLabel ?? 'Verified uploaded document'}${pageNumber ? ` · page ${pageNumber}` : ''}`,
  };
}

function clipOneLine(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > maxChars ? `${compact.slice(0, maxChars).trimEnd()}...` : compact;
}

function maybeCorrectVerifiedDocumentLabFalseNegative(
  question: string,
  answerText: string,
  data: VerifiedExternalContextToolData | null,
): AgentAnswer | null {
  if (!data || !isLabQuestion(question) || !isFalseNegativeAnswer(answerText)) return null;
  const match = findRequestedVerifiedLab(question, data);
  if (!match) return null;
  const snippet = findSnippetForLab(match.document, match.lab.name);
  const enriched = enrichLabFromSnippet(match.lab, snippet);
  const value = [match.lab.value, enriched.unit].filter(Boolean).join(' ');
  const date = enriched.collectedDate ?? match.document.dateOfRecord;
  const flag = enriched.abnormalFlag && enriched.abnormalFlag !== 'normal'
    ? `, flagged ${enriched.abnormalFlag}`
    : '';
  const range = enriched.referenceRange ? ` (reference range ${enriched.referenceRange})` : '';
  const sourcePage = enriched.sourcePage ?? match.lab.sourcePage;
  return {
    text: `${match.lab.name} was ${value}${flag}${range}, collected ${date} in the verified uploaded document, page ${sourcePage}.`,
    sources: [
      {
        kind: 'document',
        id: match.document.id,
        label: `${match.document.sourceLabel ?? 'Verified uploaded document'} · page ${sourcePage}`,
      },
    ],
    isClarification: false,
    isLLMKnowledge: false,
  };
}

function findRequestedLabValueInVerifiedPageText(
  question: string,
  data: VerifiedExternalContextToolData,
): {
  document: VerifiedExternalContextToolData['documents'][number];
  name: string;
  value: string;
  unit: string | null;
  referenceRange: string | null;
  flag: string | null;
  collectedDate: string | null;
  sourcePage: number | null;
} | null {
  const requested = requestedLabNames(question);
  if (requested.length === 0) return null;
  for (const document of data.documents) {
    for (const match of document.textMatches ?? []) {
      const parsed = parseLabValueFromText(match.text, requested);
      if (!parsed) continue;
      return {
        document,
        ...parsed,
        collectedDate: parsed.collectedDate,
        sourcePage: match.sourcePage,
      };
    }
  }
  return null;
}

function requestedLabNames(question: string): string[] {
  const normalized = normalizeClinicalText(question);
  const candidates: Array<{ canonical: string; aliases: string[] }> = [
    { canonical: 'Creatinine', aliases: ['creatinine'] },
    { canonical: 'eGFR', aliases: ['egfr', 'estimated glomerular filtration'] },
    { canonical: 'Hemoglobin A1c', aliases: ['hemoglobin a1c', 'a1c', 'hba1c'] },
    { canonical: 'Hemoglobin', aliases: ['hemoglobin', 'hgb'] },
    { canonical: 'Magnesium', aliases: ['magnesium'] },
    { canonical: 'Tacrolimus trough', aliases: ['tacrolimus trough', 'tacrolimus'] },
    { canonical: 'BUN', aliases: ['bun'] },
    { canonical: 'Potassium', aliases: ['potassium'] },
    { canonical: 'Sodium', aliases: ['sodium'] },
    { canonical: 'Glucose', aliases: ['glucose'] },
    { canonical: 'Platelets', aliases: ['platelets', 'platelet'] },
    { canonical: 'WBC', aliases: ['wbc'] },
    { canonical: 'RBC', aliases: ['rbc'] },
    { canonical: 'Hematocrit', aliases: ['hematocrit', 'hct'] },
    { canonical: 'LDL cholesterol', aliases: ['ldl cholesterol', 'ldl'] },
    { canonical: 'HDL cholesterol', aliases: ['hdl cholesterol', 'hdl'] },
    { canonical: 'Triglycerides', aliases: ['triglycerides', 'triglyceride'] },
    { canonical: 'TSH', aliases: ['tsh'] },
    { canonical: 'BNP', aliases: ['bnp'] },
    { canonical: 'CMV PCR', aliases: ['cmv pcr', 'cmv'] },
    { canonical: 'EBV PCR', aliases: ['ebv pcr', 'ebv'] },
  ];
  return candidates
    .filter((candidate) => candidate.aliases.some((alias) => normalized.includes(alias)))
    .map((candidate) => candidate.canonical);
}

function parseLabValueFromText(
  text: string,
  labNames: string[],
): {
  name: string;
  value: string;
  unit: string | null;
  referenceRange: string | null;
  flag: string | null;
  collectedDate: string | null;
} | null {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const labName of labNames) {
    const normalizedLabName = normalizeClinicalText(labName);
    const labLineIndex = lines.findIndex((line) =>
      normalizeClinicalText(line) === normalizedLabName ||
      normalizeClinicalText(line).startsWith(`${normalizedLabName} `),
    );
    if (labLineIndex < 0) continue;
    const windowLines = lines.slice(labLineIndex, labLineIndex + 12);
    const sameLine = parseLabValueFromSingleLine(windowLines[0]!, labName);
    if (sameLine) {
      return {
        ...sameLine,
        collectedDate: sameLine.collectedDate ?? extractDateFromText(text),
      };
    }
    const valueIndex = windowLines.findIndex((line, index) =>
      index > 0 && isLikelyLabValue(line),
    );
    if (valueIndex < 0) continue;
    const afterValue = windowLines.slice(valueIndex + 1);
    const flagLine = afterValue.find((line) => isLikelyLabFlag(line));
    const unitLine = afterValue.find((line) => isLikelyLabUnit(line)) ?? null;
    const referenceRange = afterValue.find((line) => isLikelyReferenceRange(line)) ?? null;
    return {
      name: labName,
      value: windowLines[valueIndex]!,
      unit: unitLine,
      referenceRange,
      flag: flagLine ? normalizeLabFlag(flagLine) : null,
      collectedDate: extractDateFromText(text),
    };
  }
  return null;
}

function parseLabValueFromSingleLine(
  line: string,
  labName: string,
): {
  name: string;
  value: string;
  unit: string | null;
  referenceRange: string | null;
  flag: string | null;
  collectedDate: string | null;
} | null {
  const match = line.match(
    new RegExp(`^${escapeRegExp(labName)}\\s+([<>]?\\d+(?:\\.\\d+)?|not detected|detected)\\s*(H|L|A|high|low|abnormal)?\\s*([^\\s]+)?\\s*(\\d+(?:\\.\\d+)?\\s*-\\s*\\d+(?:\\.\\d+)?|[<>]\\s*\\d+(?:\\.\\d+)?)?`, 'i'),
  );
  if (!match?.[1]) return null;
  return {
    name: labName,
    value: match[1],
    flag: match[2] ? normalizeLabFlag(match[2]) : null,
    unit: match[3] && isLikelyLabUnit(match[3]) ? match[3] : null,
    referenceRange: match[4] ?? null,
    collectedDate: null,
  };
}

function extractDateFromText(text: string): string | null {
  const labeledDate = text.match(/\b(?:Collected|Collection date|Date|Reported):\s*((?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}\/\d{1,2}\/20\d{2})|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+20\d{2})|(?:\d{1,2}-[A-Z][a-z]{2}-20\d{2}))/i)?.[1];
  return labeledDate
    ?? text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]
    ?? text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+20\d{2}\b/i)?.[0]
    ?? text.match(/\b\d{1,2}\/\d{1,2}\/20\d{2}\b/)?.[0]
    ?? null;
}

function isLikelyLabValue(line: string): boolean {
  return /^(?:[<>]?\d+(?:\.\d+)?|not detected|detected)$/i.test(line);
}

function isLikelyLabFlag(line: string): boolean {
  return /^(?:H|L|A|high|low|abnormal|critical)$/i.test(line);
}

function isLikelyLabUnit(line: string): boolean {
  return /^(?:mg\/dL|g\/dL|mL\/min(?:\/1\.73m\s*2|\/1\.73m2)?|%|ng\/mL|K\/uL|M\/uL|mmol\/L|mEq\/L|pg\/mL|mIU\/L|IU\/mL|copies\/mL|U\/L)$/i.test(line);
}

function isLikelyReferenceRange(line: string): boolean {
  return /^(?:\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?|[<>]\s*\d+(?:\.\d+)?)$/i.test(line);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findSnippetForLab(
  document: VerifiedExternalContextToolData['documents'][number],
  labName: string,
): { text: string; sourcePage: number | null } | null {
  const normalizedName = normalizeClinicalText(labName);
  const match = document.textMatches?.find((snippet) =>
    normalizeClinicalText(snippet.text).includes(normalizedName),
  );
  return match ? { text: match.text, sourcePage: match.sourcePage } : null;
}

function enrichLabFromSnippet(
  lab: VerifiedExternalContextToolData['documents'][number]['labs'][number],
  snippet: { text: string; sourcePage: number | null } | null,
) {
  const enriched = {
    unit: lab.unit,
    referenceRange: lab.referenceRange,
    abnormalFlag: lab.abnormalFlag,
    collectedDate: lab.collectedDate,
    sourcePage: lab.sourcePage as number | null,
  };
  if (!snippet) return enriched;

  if (snippet.sourcePage) enriched.sourcePage = snippet.sourcePage;
  const lines = snippet.text.split('\n').map((line) => line.trim()).filter(Boolean);
  const labLineIndex = lines.findIndex((line) =>
    normalizeClinicalText(line).includes(normalizeClinicalText(lab.name)),
  );
  const windowLines = lines.slice(Math.max(0, labLineIndex), labLineIndex >= 0 ? labLineIndex + 14 : 14);
  const windowText = windowLines.join('\n');

  enriched.unit ??= windowLines.find((line) =>
    /^(mg\/dL|g\/dL|mL\/min\/1\.73m\s*2|mL\/min\/1\.73m2|%|ng\/mL|K\/uL|M\/uL|mmol\/L|mEq\/L|pg\/mL|mIU\/L|IU\/mL|copies\/mL)$/i.test(line),
  ) ?? null;
  enriched.referenceRange ??= windowText.match(/(?:\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?|[<>]\s*\d+(?:\.\d+)?(?:\s+\w+)*)/)?.[0] ?? null;
  enriched.collectedDate ??= windowText.match(/\b\d{1,2}\/\d{1,2}\/20\d{2}\b/)?.[0]
    ?? windowText.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0]
    ?? null;
  if (!enriched.abnormalFlag) {
    const flag = windowLines.find((line) => /^(H|L|A|high|low|abnormal|critical)$/i.test(line));
    enriched.abnormalFlag = flag ? normalizeLabFlag(flag) : null;
  }
  return enriched;
}

function normalizeLabFlag(flag: string): string {
  const normalized = flag.trim().toLowerCase();
  if (normalized === 'h') return 'high';
  if (normalized === 'l') return 'low';
  if (normalized === 'a') return 'abnormal';
  return normalized;
}

function isLabQuestion(question: string): boolean {
  return /\b(lab|labs|laboratory|creatinine|egfr|eGFR|a1c|hgb|hemoglobin|magnesium|tacrolimus|trough|glucose|bun|potassium|sodium|platelet|wbc|rbc|hematocrit|ldl|hdl|triglyceride|tsh|bnp|cmv|ebv)\b/i
    .test(question);
}

function isMedicationQuestion(question: string): boolean {
  return /\b(medication|medications|medicine|medicines|meds?|drug|drugs|dose|dosing|rx|prescription|tacrolimus|mycophenolate|prednisone|valganciclovir|tmp-smx|trimethoprim|sulfamethoxazole|aspirin|pravastatin|amlodipine|hydralazine|insulin|metformin|pantoprazole|magnesium|tamsulosin|sertraline|epinephrine|warfarin|losartan)\b/i
    .test(question);
}

function isAllergyQuestion(question: string): boolean {
  return /\b(allergy|allergies|allergic|allergen|anaphylaxis|penicillin|latex|bee|hymenoptera|sting|stings|rash|urticaria)\b/i
    .test(question);
}

function isDiagnosisQuestion(question: string): boolean {
  return /\b(diagnosis|diagnoses|problem|problems|condition|conditions|icd|heart transplant|transplant|immunosuppression|hypertension|diabetes|ckd|kidney|hyperlipidemia|cva|stroke|mca|deconditioning|fall risk|sleep apnea|bph)\b/i
    .test(question);
}

function isProcedureOrRehabQuestion(question: string): boolean {
  return /\b(procedure|procedures|surgery|operative|imaging|image|x-ray|xray|ct|mri|echo|ekg|biopsy|rehab|rehabilitation|physical therapy|occupational therapy|therapy|pt|ot|timed up and go|tug|6 minute walk|6mw|grip|functional|function)\b/i
    .test(question);
}

function isPresenceQuestion(question: string): boolean {
  return /\b(show|find|search|mention|mentioned|documented|listed|contains|contain|present|absent|available|in the uploaded|outside record|packet)\b/i
    .test(question);
}

function clinicalQueryTermsForAgent(question: string): string[] {
  const stopwords = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'can',
    'did',
    'do',
    'does',
    'for',
    'from',
    'has',
    'have',
    'his',
    'her',
    'in',
    'is',
    'it',
    'me',
    'of',
    'on',
    'or',
    'patient',
    'record',
    'records',
    'show',
    'tell',
    'the',
    'this',
    'to',
    'uploaded',
    'was',
    'were',
    'what',
    'which',
    'with',
  ]);
  return Array.from(new Set(
    normalizeClinicalText(question)
      .split(' ')
      .filter((term) => term.length >= 3 && !stopwords.has(term)),
  ));
}

function maybeAnswerVerifiedDocumentPageRequest(
  question: string,
  data: VerifiedExternalContextToolData | null,
): AgentAnswer | null {
  const pageNumber = requestedDocumentPageNumber(question);
  if (!pageNumber || !data) return null;
  const document = data.documents.find((doc) =>
    doc.pages?.some((page) => page.pageNumber === pageNumber && page.text.trim().length > 0),
  );
  const page = document?.pages?.find((candidate) =>
    candidate.pageNumber === pageNumber && candidate.text.trim().length > 0,
  );
  if (!document || !page) return null;

  const maxChars = 6_000;
  const pageText = page.text.trim();
  const clipped = pageText.length > maxChars
    ? `${pageText.slice(0, maxChars).trimEnd()}\n\n[Page text truncated after ${maxChars} characters.]`
    : pageText;
  const fileLabel = page.fileIndex > 0 ? `file ${page.fileIndex + 1}, ` : '';
  return {
    text: `Page ${page.pageNumber} from the verified uploaded document (${fileLabel}${page.characterCount} characters):\n\n${clipped}`,
    sources: [
      {
        kind: 'document',
        id: document.id,
        label: `${document.sourceLabel ?? 'Verified uploaded document'} · page ${page.pageNumber}`,
      },
    ],
    isClarification: false,
    isLLMKnowledge: false,
  };
}

function requestedDocumentPageNumber(question: string): number | null {
  const match = question.match(/\b(?:page|p\.?)\s*#?\s*(\d{1,3})\b/i);
  if (!match?.[1]) return null;
  const pageNumber = Number(match[1]);
  return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : null;
}

function isFalseNegativeAnswer(answerText: string): boolean {
  return /\b(i don't see|i don&apos;t see|i do not see|doesn't see|doesn&apos;t see|does not see|no .*found|not found|not mentioned|no .*documented|without .*mentioned|couldn't find|couldn&apos;t find|could not find)\b/i
    .test(answerText);
}

function findRequestedVerifiedLab(
  question: string,
  data: VerifiedExternalContextToolData,
) {
  const normalizedQuestion = normalizeClinicalText(question);
  const candidates = data.documents.flatMap((document) =>
    (Array.isArray(document.labs) ? document.labs : []).map((lab) => ({ document, lab })),
  ).filter(({ lab }) => labMatchesQuestion(normalizedQuestion, lab.name));

  return candidates.sort((a, b) => labSortMs(b) - labSortMs(a))[0] ?? null;
}

function labMatchesQuestion(normalizedQuestion: string, labName: string): boolean {
  const normalizedName = normalizeClinicalText(labName);
  if (!normalizedName) return false;
  if (normalizedQuestion.includes(normalizedName)) return true;
  const aliases = labAliases(normalizedName);
  if (aliases.some((alias) => normalizedQuestion.includes(alias))) return true;
  const tokens = normalizedName.split(' ').filter((token) => token.length >= 3);
  return tokens.length > 0 && tokens.every((token) => normalizedQuestion.includes(token));
}

function labAliases(normalizedName: string): string[] {
  const aliases = [normalizedName];
  if (normalizedName === 'hemoglobin a1c') aliases.push('a1c', 'hba1c');
  if (normalizedName === 'egfr') aliases.push('gfr');
  if (normalizedName === 'hemoglobin') aliases.push('hgb');
  if (normalizedName === 'hematocrit') aliases.push('hct');
  if (normalizedName === 'tacrolimus trough') aliases.push('tacrolimus', 'tacro', 'trough');
  return aliases;
}

function labSortMs(candidate: {
  document: VerifiedExternalContextToolData['documents'][number];
  lab: VerifiedExternalContextToolData['documents'][number]['labs'][number];
}): number {
  return parseClinicalDateMs(candidate.lab.collectedDate)
    ?? parseClinicalDateMs(candidate.document.dateOfRecord)
    ?? 0;
}

function parseClinicalDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (mdy) {
    return Date.UTC(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]));
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeClinicalText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function buildUserPrompt(
  input: AgentInput,
  turns: AgentTurn[],
  lastChance: boolean,
  mode: AgentMode = 'chart',
): string {
  // Research mode is patient-agnostic — no patient context block in the
  // user prompt. The system prompt locks the "do not tailor to a specific
  // patient" rule; omitting the ids here removes any temptation for the
  // model to leak patient identifiers into search queries.
  const head =
    mode === 'research'
      ? '<context>\n  research mode — no patient context\n</context>'
      : [
          `<context>`,
          `  patientId: ${input.patientId}`,
          `  noteId: ${input.noteId ?? '(none)'}`,
          // Phase 1A — be explicit when there is no episode of care so
          // the model can route goal questions through
          // lookupPatientGoals instead of looping on lookupEpisodeGoals
          // with no episodeId to pass.
          input.episodeId
            ? `  episodeId: ${input.episodeId}`
            : `  episodeId: (none — this visit has no episode of care; use lookupPatientGoals for goals)`,
          `</context>`,
        ].join('\n');

  const conversation = turns
    .map((t) => {
      if (t.role === 'user') return `<user>\n${t.content}\n</user>`;
      if (t.role === 'assistant') return `<assistant>\n${t.content}\n</assistant>`;
      return `<tool-result>\n${t.content}\n</tool-result>`;
    })
    .join('\n');

  const lastChanceHint = lastChance
    ? '\n\nNOTE: tool budget exhausted. Your next response MUST be { action: "answer" }.'
    : '';

  return `${head}\n\n${conversation}${lastChanceHint}\n\nRespond with strict JSON only.`;
}

type ParsedOutput =
  | { ok: true; value: ParsedAction }
  | { ok: false; error: string };

type ParsedAction =
  | { action: 'tool'; tool: string; args: unknown }
  | { action: 'answer'; text: string; sources?: AskSource[] }
  /** Unit 31 — free intra-step annotation. Does NOT consume an iteration
   *  slot; the loop accumulates it into reasoningSteps and continues. */
  | { action: 'think'; summary: string }
  /** Phase 1B — research-mode-only LLM-knowledge fallback. The model
   *  emits this after literature tools have come up empty; the agent
   *  converts it to an AgentAnswer with `isLLMKnowledge: true` plus a
   *  synthetic `llm-intrinsic` source. Chart mode rejects this action
   *  with a `wrong_mode_fallback` tool-result (fail-closed). */
  | { action: 'answer-from-knowledge'; text: string; topic: string };

function parseModelOutput(raw: string): ParsedOutput {
  const trimmed = stripJsonFence(raw);
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: 'non-JSON response' };
  }
  if (!json || typeof json !== 'object') {
    return { ok: false, error: 'response is not an object' };
  }
  const obj = json as Record<string, unknown>;
  if (obj.action === 'tool') {
    if (typeof obj.tool !== 'string') return { ok: false, error: 'tool action missing tool name' };
    return { ok: true, value: { action: 'tool', tool: obj.tool, args: obj.args ?? {} } };
  }
  if (obj.action === 'answer') {
    if (typeof obj.text !== 'string') return { ok: false, error: 'answer action missing text' };
    const sources = parseSources(obj.sources);
    return { ok: true, value: { action: 'answer', text: obj.text, sources } };
  }
  if (obj.action === 'think') {
    if (typeof obj.summary !== 'string') {
      return { ok: false, error: 'think action missing summary' };
    }
    // Truncate (don't reject) — better to keep the model moving forward.
    // The system prompt instructs ≤120 chars; if the model overshoots
    // we'll surface only the first 120.
    const summary = obj.summary.length > MAX_THINK_SUMMARY
      ? obj.summary.slice(0, MAX_THINK_SUMMARY)
      : obj.summary;
    return { ok: true, value: { action: 'think', summary } };
  }
  if (obj.action === 'answer-from-knowledge') {
    if (typeof obj.text !== 'string') {
      return { ok: false, error: 'answer-from-knowledge action missing text' };
    }
    if (typeof obj.topic !== 'string') {
      return { ok: false, error: 'answer-from-knowledge action missing topic' };
    }
    const topic = obj.topic.length > 80 ? obj.topic.slice(0, 80) : obj.topic;
    return { ok: true, value: { action: 'answer-from-knowledge', text: obj.text, topic } };
  }
  return { ok: false, error: `unknown action: ${String(obj.action)}` };
}

function parseSources(raw: unknown): AskSource[] {
  if (!Array.isArray(raw)) return [];
  const out: AskSource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    if (
      (s.kind === 'note' ||
        s.kind === 'follow-up' ||
        s.kind === 'goal' ||
        s.kind === 'patient' ||
        s.kind === 'fhir' ||
        s.kind === 'document' ||
        s.kind === 'literature' ||
        s.kind === 'llm-intrinsic') &&
      typeof s.id === 'string' &&
      typeof s.label === 'string'
    ) {
      out.push({ kind: s.kind, id: s.id, label: s.label });
    }
  }
  return out;
}
