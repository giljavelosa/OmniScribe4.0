import type { LLMService } from '@/services/llm';
import { getLLMService } from '@/services/llm';
import { runTool, type AskSource } from './tools';

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

export type AgentInput = {
  patientId: string;
  noteId: string;
  /** Optional — passed through to the model in the system prompt so it
   *  knows which episode to ask about for goal lookups. */
  episodeId?: string | null;
  history: AgentTurn[];
  question: string;
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
patient during their visit. You have access to read-only lookup tools:

  In-app (always available):
  - lookupSignedNote({ noteId })             → returns sections + signedAt
  - lookupFollowUp({ patientId, status? })   → returns up to 10 follow-ups
  - lookupEpisodeGoals({ episodeId })        → returns active goals
  - lookupPatientDemographics({ patientId }) → returns name, dob, sex, mrn

  EHR-backed (require a verified patient-to-EHR link — Rule 20):
  - lookupFhirCondition({ patientId, clinicalStatus? })
  - lookupFhirMedication({ patientId, status? })
  - lookupFhirObservation({ patientId, code? })
  - lookupFhirAllergy({ patientId })
  - lookupFhirCarePlan({ patientId })

When a FHIR tool returns { error: "verified_link_required" }, tell the clinician:
"This patient isn't linked to an EHR record yet. Confirm the match on the
patient page to enable EHR-backed answers." Use a single source of
{ kind: "patient", id: <patientId>, label: "Confirm EHR link" }.

When a FHIR tool returns { error: "fhir_rate_limit_exceeded" }, answer with
what you already have and tell the clinician you've hit the session lookup
budget for EHR data.

Sources for FHIR-derived facts use { kind: "fhir", id: <fhirResourceId>, label }.

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
      { "kind": "note" | "follow-up" | "goal" | "patient",
        "id": "<id>",
        "label": "<short human label>" } ] }

To ask the clinician a clarifying question (when you can't answer):
  { "action": "answer", "text": "<your question>", "sources": [] }

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

  let stub = false;
  let iterations = 0;
  while (iterations < MAX_ITERATIONS) {
    iterations += 1;
    const userPrompt = buildUserPrompt(input, turns, iterations === MAX_ITERATIONS);
    const result = await llm.generate(ASK_SYSTEM_PROMPT, userPrompt, {
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
      const toolResult = await runTool(parsed.value.tool, parsed.value.args, toolCtx);
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

function buildUserPrompt(input: AgentInput, turns: AgentTurn[], lastChance: boolean): string {
  const head = [
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
        s.kind === 'fhir') &&
      typeof s.id === 'string' &&
      typeof s.label === 'string'
    ) {
      out.push({ kind: s.kind, id: s.id, label: s.label });
    }
  }
  return out;
}
