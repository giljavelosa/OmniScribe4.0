import type { LLMService } from '@/services/llm';
import { getLLMService } from '@/services/llm';
import { runTool, type AskSource } from './tools';
import { RESEARCH_TOOL_NAMES, runResearchTool } from './research-tools';

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
};

export type AgentOutput = {
  answer: AgentAnswer;
  toolCalls: AgentToolCall[];
  iterations: number;
  stub: boolean;
};

export type AgentContext = {
  orgId: string;
};

export const ASK_SYSTEM_PROMPT = `
You are a clinical co-pilot answering a clinician's question about a specific
patient during their visit. You have access to four read-only lookup tools:

  - lookupSignedNote({ noteId })             → returns sections + signedAt
  - lookupFollowUp({ patientId, status? })   → returns up to 10 follow-ups
  - lookupEpisodeGoals({ episodeId })        → returns active goals
  - lookupPatientDemographics({ patientId }) → returns name, dob, sex, mrn

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

2. CITE EVERY CLAIM.
   Every fact in your answer must cite at least one entry from a tool result
   via the sources array. Use kind: "literature" with the source id (PMC id
   or attested-literature id) and a short citation label like
   "Smith 2024 (NEJM)".

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

The very first character of every response is { and the very last is }.
`.trim();

export async function runAgent(
  input: AgentInput,
  ctx: AgentContext,
  llm: LLMService = getLLMService(),
): Promise<AgentOutput> {
  const toolCalls: AgentToolCall[] = [];
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
  const systemPrompt = mode === 'research' ? RESEARCH_SYSTEM_PROMPT : ASK_SYSTEM_PROMPT;

  let stub = false;
  let iterations = 0;
  while (iterations < MAX_ITERATIONS) {
    iterations += 1;
    const userPrompt = buildUserPrompt(input, turns, iterations === MAX_ITERATIONS, mode);
    const result = await llm.generate(systemPrompt, userPrompt, {
      phi: true,
      temperature: 0,
      jsonMode: true,
      model: 'sonnet',
      maxTokens: 800,
    });
    stub = !!result.stub;
    if (stub) {
      return {
        answer: {
          text: 'Ask mode runs against Bedrock — set AWS_BEARER_TOKEN_BEDROCK + BEDROCK_MODEL_ID to use it in real mode.',
          sources: [],
          isClarification: true,
        },
        toolCalls,
        iterations,
        stub,
      };
    }

    const parsed = parseModelOutput(result.text);
    if (!parsed.ok) {
      // Record the model's own (invalid) response in history so its retry
      // can see what failed.
      turns.push({ role: 'assistant', content: result.text });
      turns.push({
        role: 'tool-result',
        content: `previous response failed validation: ${parsed.error}. Return strict JSON.`,
      });
      continue;
    }

    if (parsed.value.action === 'tool') {
      // Record the model's tool-call decision in history so subsequent
      // iterations see the reasoning chain (without this, the model loses
      // its own prior outputs and re-calls or contradicts itself).
      turns.push({ role: 'assistant', content: result.text });
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
      turns.push({
        role: 'tool-result',
        content: JSON.stringify({
          tool: parsed.value.tool,
          result: toolResult.ok ? toolResult.data : { error: toolResult.error },
        }),
      });
      continue;
    }

    // action === 'answer'
    const sources = parsed.value.sources ?? [];
    return {
      answer: {
        text: parsed.value.text,
        sources,
        isClarification: sources.length === 0,
      },
      toolCalls,
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
    },
    toolCalls,
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
          input.episodeId ? `  episodeId: ${input.episodeId}` : null,
          `</context>`,
        ]
          .filter(Boolean)
          .join('\n');

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
  | { action: 'answer'; text: string; sources?: AskSource[] };

function parseModelOutput(raw: string): ParsedOutput {
  const trimmed = raw.trim();
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
        s.kind === 'literature') &&
      typeof s.id === 'string' &&
      typeof s.label === 'string'
    ) {
      out.push({ kind: s.kind, id: s.id, label: s.label });
    }
  }
  return out;
}
