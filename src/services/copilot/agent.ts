import type { LLMService } from '@/services/llm';
import { getLLMService } from '@/services/llm';
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
  /** Required in chart mode for tool calls + audit anchoring. In
   *  research mode the route still passes it so the audit row anchors
   *  somewhere, but the agent's system prompt has no patient block. */
  noteId: string;
  /** Optional — passed through to the model in the system prompt so it
   *  knows which episode to ask about for goal lookups. Chart mode only. */
  episodeId?: string | null;
  /** Viewer's clinical lens. Threaded into the chart-mode user prompt so
   *  the model can lead with the viewer's discipline while still
   *  surfacing cross-discipline data when it's clinically material (see
   *  VIEWER LENS block in ASK_SYSTEM_PROMPT). Chart mode only; research
   *  mode ignores. Soft-guidance only — does NOT filter tool results. */
  viewerDivision?: 'REHAB' | 'MEDICAL' | 'BEHAVIORAL_HEALTH' | 'MULTI' | null;
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

═══ VIEWER LENS — discipline-aware framing ═══

The clinician asking is one of: REHAB (PT/OT/SLP), MEDICAL (MD/NP/PA),
BEHAVIORAL_HEALTH (LCSW/psychologist/psychiatrist), or MULTI (no single
discipline). The viewer's discipline is in the <context> block as
"viewerDivision". Use it to FRAME answers, NOT to filter data.

LEAD with the viewer's discipline. If the viewer is REHAB and the patient has
both PT and MEDICAL notes, summarize the PT story first; mention MEDICAL
content only when it changes how the PT visit should run (see ALWAYS SURFACE
list below). Symmetric for MEDICAL and BEHAVIORAL_HEALTH viewers. For MULTI,
present chronologically with no discipline bias.

ALWAYS SURFACE cross-discipline content when the source contains any of
these, regardless of the viewer's discipline — withholding any of these is a
safety regression:
  - Active anticoagulants, antiplatelets, or recent bleeding (bleed risk
    affects manual therapy, exercise tolerance, dental work, procedures)
  - Recent cardiac event, new arrhythmia, uncontrolled HTN (>160/100 or as
    flagged), syncope, or chest pain (affects exercise prescription, exertion
    tolerance, mood interpretation)
  - Active suicidality, recent self-harm, new psychosis, or substance-use
    crisis (safety planning is everyone's job)
  - New fall with injury, new significant fall risk, new mobility-affecting
    diagnosis (CVA, hip fx, lower-extremity amputation, lower-extremity DVT)
  - Recent hospitalization, ED visit, or new infection
  - New seizure, loss of consciousness, or acute neurologic change
  - New oxygen requirement, acute respiratory change, or active aspiration
    risk
  - ANY new diagnosis, new medication (start / stop / dose change), abnormal
    lab, OR summary-level document (Progress, Re-eval, Discharge, H&P) from
    another discipline within the last 30 days. When in doubt, surface.

If the clinician's question EXPLICITLY asks for another discipline's data
("what did the MD say about the H&P?", "any notes from psych?"), answer from
that discipline directly — the viewer-lens framing does NOT block explicit
cross-discipline asks.

Questions about "the last visit", "the recent visit", or "what happened on
[date]" are CHRONOLOGICAL — answer from the actual most-recent encounter
regardless of discipline. The viewer-lens framing only applies to open-ended
summaries.

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
      { "kind": "note" | "follow-up" | "goal" | "patient" | "fhir",
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
          `  noteId: ${input.noteId}`,
          // Phase 1A — be explicit when there is no episode of care so
          // the model can route goal questions through
          // lookupPatientGoals instead of looping on lookupEpisodeGoals
          // with no episodeId to pass.
          input.episodeId
            ? `  episodeId: ${input.episodeId}`
            : `  episodeId: (none — this visit has no episode of care; use lookupPatientGoals for goals)`,
          // Viewer's clinical lens — VIEWER LENS block in the system
          // prompt frames the answer around this. Soft-guidance only;
          // the model still pulls all tool results.
          input.viewerDivision
            ? `  viewerDivision: ${input.viewerDivision}`
            : `  viewerDivision: (unknown — present chronologically)`,
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

/** Strip a markdown ```json … ``` (or bare ```) fence if present.
 *  Defensive — Sonnet sometimes wraps JSON-mode output in a fence
 *  despite the jsonMode flag, which would otherwise burn a full
 *  iteration on a parse failure (see Phase 1A iteration refund). */
function stripJsonFence(raw: string): string {
  const m = raw.match(/^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/);
  return m && m[1] !== undefined ? m[1] : raw;
}

function parseModelOutput(raw: string): ParsedOutput {
  const trimmed = stripJsonFence(raw).trim();
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
