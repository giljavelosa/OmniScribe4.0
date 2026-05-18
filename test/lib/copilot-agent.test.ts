import { describe, expect, it } from 'vitest';

import { runAgent } from '@/services/copilot/agent';
import type { LLMService } from '@/services/llm';

/**
 * Agent loop tests — Unit 27.
 *
 * Stubbed LLMService produces scripted JSON responses per turn. Each
 * test exercises a path through the loop: direct answer, single tool
 * call → answer, multi-tool, max iterations, parse-error retry, stub
 * envelope.
 *
 * Real Bedrock + real tools are exercised manually against the dev
 * environment + the verify-when-done list; this suite locks the
 * orchestration logic.
 */

function scriptedLlm(responses: Array<string | { stub: true; text: string }>): LLMService {
  let i = 0;
  return {
    async generate() {
      const next = responses[i++];
      if (!next) throw new Error('script ran out of responses');
      if (typeof next === 'object' && 'stub' in next && next.stub) {
        return {
          text: next.text,
          model: 'stub',
          latencyMs: 1,
          tokensIn: 0,
          tokensOut: 0,
          stub: true,
        };
      }
      return {
        text: next as string,
        model: 'sonnet',
        latencyMs: 1,
        tokensIn: 10,
        tokensOut: 20,
      };
    },
    async *generateStream() {
      throw new Error('not used');
    },
  };
}

describe('runAgent', () => {
  const baseInput = {
    patientId: 'pat-1',
    noteId: 'note-1',
    history: [],
    question: 'what is the plan from her last visit?',
  };
  const ctx = { orgId: 'org-1' };

  it('returns direct answer with sources on first turn', async () => {
    const llm = scriptedLlm([
      JSON.stringify({
        action: 'answer',
        text: 'Continue current home program.',
        sources: [{ kind: 'note', id: 'note-prev', label: 'Last visit 2026-05-10' }],
      }),
    ]);
    const out = await runAgent(baseInput, ctx, llm);
    expect(out.answer.text).toBe('Continue current home program.');
    expect(out.answer.sources).toHaveLength(1);
    expect(out.answer.isClarification).toBe(false);
    expect(out.iterations).toBe(1);
    expect(out.toolCalls).toHaveLength(0);
    expect(out.stub).toBe(false);
  });

  it('returns clarification (empty sources) without flagging as final answer', async () => {
    const llm = scriptedLlm([
      JSON.stringify({
        action: 'answer',
        text: 'Which previous visit are you asking about — the most recent one?',
        sources: [],
      }),
    ]);
    const out = await runAgent(baseInput, ctx, llm);
    expect(out.answer.isClarification).toBe(true);
    expect(out.answer.sources).toEqual([]);
  });

  it('runs a tool call then returns an answer', async () => {
    const llm = scriptedLlm([
      JSON.stringify({
        action: 'tool',
        tool: 'lookupSignedNote',
        args: { noteId: 'note-prev' },
      }),
      JSON.stringify({
        action: 'answer',
        text: 'The plan was to continue HEP and recheck in 2 weeks.',
        sources: [{ kind: 'note', id: 'note-prev', label: 'Last visit' }],
      }),
    ]);
    const out = await runAgent(baseInput, ctx, llm);
    // The first turn's tool call fails because note-prev doesn't exist
    // in the test DB, but the agent still surfaces a tool-result + the
    // model's second turn returns the answer.
    expect(out.iterations).toBe(2);
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0]!.tool).toBe('lookupSignedNote');
    expect(out.answer.text).toContain('plan');
  });

  it('retries once on parse error then returns answer', async () => {
    const llm = scriptedLlm([
      'not valid JSON at all',
      JSON.stringify({
        action: 'answer',
        text: 'Recovered after parse retry.',
        sources: [{ kind: 'patient', id: 'pat-1', label: 'Patient' }],
      }),
    ]);
    const out = await runAgent(baseInput, ctx, llm);
    expect(out.iterations).toBe(2);
    expect(out.answer.text).toBe('Recovered after parse retry.');
  });

  it('bails after MAX_ITERATIONS when the model never answers', async () => {
    const toolCall = JSON.stringify({
      action: 'tool',
      tool: 'lookupSignedNote',
      args: { noteId: 'note-loop' },
    });
    const llm = scriptedLlm([toolCall, toolCall, toolCall, toolCall]);
    const out = await runAgent(baseInput, ctx, llm);
    expect(out.iterations).toBe(4);
    expect(out.answer.isClarification).toBe(true);
    expect(out.answer.text).toMatch(/tool budget/);
  });

  it('returns canned stub response without invoking tools when LLM is stubbed', async () => {
    const llm = scriptedLlm([{ stub: true, text: 'irrelevant' }]);
    const out = await runAgent(baseInput, ctx, llm);
    expect(out.stub).toBe(true);
    expect(out.toolCalls).toHaveLength(0);
    expect(out.answer.text).toMatch(/Bedrock/);
    expect(out.answer.isClarification).toBe(true);
  });

  it('refuses to call a chart tool in research mode (wrong_mode_tool)', async () => {
    const llm = scriptedLlm([
      // Model picks a chart tool while we're in research mode.
      JSON.stringify({
        action: 'tool',
        tool: 'lookupSignedNote',
        args: { noteId: 'note-x' },
      }),
      // After the tool-result error, the model gives up and answers.
      JSON.stringify({
        action: 'answer',
        text: 'I cannot answer in research mode — switch to Chart tab.',
        sources: [{ kind: 'literature', id: 'PMC123', label: 'Smith 2024 (NEJM)' }],
      }),
    ]);
    const out = await runAgent(
      { ...baseInput, mode: 'research', question: 'evidence on X?' },
      ctx,
      llm,
    );
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0]!.resultOk).toBe(false);
    expect(out.answer.sources[0]?.kind).toBe('literature');
  });

  it('refuses to call a research tool in chart mode (wrong_mode_tool)', async () => {
    const llm = scriptedLlm([
      JSON.stringify({
        action: 'tool',
        tool: 'searchPMC',
        args: { query: 'irrelevant' },
      }),
      JSON.stringify({
        action: 'answer',
        text: 'recovered',
        sources: [{ kind: 'patient', id: 'pat-1', label: 'patient' }],
      }),
    ]);
    const out = await runAgent({ ...baseInput, mode: 'chart' }, ctx, llm);
    expect(out.toolCalls[0]!.resultOk).toBe(false);
  });

  it('runs a research tool in research mode + returns a literature source', async () => {
    const llm = scriptedLlm([
      JSON.stringify({
        action: 'tool',
        tool: 'searchPMC',
        args: { query: 'NSAIDs in CKD' },
      }),
      JSON.stringify({
        action: 'answer',
        text: 'Recent literature suggests caution.',
        sources: [{ kind: 'literature', id: 'PMC8675309', label: 'Doe 2024 (JAMA)' }],
      }),
    ]);
    const out = await runAgent(
      { ...baseInput, mode: 'research', question: 'NSAIDs in CKD?' },
      ctx,
      llm,
    );
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0]!.resultOk).toBe(true);
    expect(out.toolCalls[0]!.rowCount).toBeGreaterThan(0);
    expect(out.answer.sources[0]?.kind).toBe('literature');
  });

  // ──────────────────────────────────────────────────────────────────
  // Unit 31 — clinical reasoning chains
  // ──────────────────────────────────────────────────────────────────

  it('accumulates a think step then proceeds to tool + answer', async () => {
    const llm = scriptedLlm([
      JSON.stringify({
        action: 'think',
        summary: 'Last visit likely has the plan; lookup the signed note.',
      }),
      JSON.stringify({
        action: 'tool',
        tool: 'lookupSignedNote',
        args: { noteId: 'note-prev' },
      }),
      JSON.stringify({
        action: 'answer',
        text: 'The plan was to continue HEP.',
        sources: [{ kind: 'note', id: 'note-prev', label: 'Last visit' }],
      }),
    ]);
    const out = await runAgent(baseInput, ctx, llm);
    expect(out.reasoningSteps).toHaveLength(1);
    expect(out.reasoningSteps[0]).toEqual({
      index: 1,
      summary: 'Last visit likely has the plan; lookup the signed note.',
    });
    // think is free — only the tool + answer turns consumed iterations.
    expect(out.iterations).toBe(2);
    expect(out.toolCalls).toHaveLength(1);
  });

  it('truncates think summary at MAX_THINK_SUMMARY (120 chars)', async () => {
    const tooLong = 'x'.repeat(200);
    const llm = scriptedLlm([
      JSON.stringify({ action: 'think', summary: tooLong }),
      JSON.stringify({
        action: 'answer',
        text: 'done',
        sources: [{ kind: 'patient', id: 'pat-1', label: 'Patient' }],
      }),
    ]);
    const out = await runAgent(baseInput, ctx, llm);
    expect(out.reasoningSteps).toHaveLength(1);
    expect(out.reasoningSteps[0]!.summary.length).toBe(120);
    expect(out.reasoningSteps[0]!.summary).toBe('x'.repeat(120));
  });

  it('caps reasoning chain at MAX_THINK_STEPS (5); extras drop + nudge model', async () => {
    // 6 think steps, then an answer. The chain should top out at 5;
    // the 6th think becomes a no-op (consumes an iteration via the
    // budget-exhausted nudge path) and the answer follows.
    const think = (i: number) =>
      JSON.stringify({ action: 'think', summary: `step ${i}` });
    const llm = scriptedLlm([
      think(1),
      think(2),
      think(3),
      think(4),
      think(5),
      think(6), // 6th — silently dropped from chain, iteration NOT refunded
      JSON.stringify({
        action: 'answer',
        text: 'done',
        sources: [{ kind: 'patient', id: 'pat-1', label: 'Patient' }],
      }),
    ]);
    const out = await runAgent(baseInput, ctx, llm);
    expect(out.reasoningSteps).toHaveLength(5);
    expect(out.reasoningSteps.map((s) => s.summary)).toEqual([
      'step 1',
      'step 2',
      'step 3',
      'step 4',
      'step 5',
    ]);
  });

  it('does not hang when the model only ever emits think actions', async () => {
    // 20 think responses — far past MAX_THINK_STEPS. Once the chain
    // tops out, the iteration counter is no longer refunded, so the
    // loop terminates at MAX_ITERATIONS with a graceful fallback.
    const think = JSON.stringify({ action: 'think', summary: 'thinking' });
    const llm = scriptedLlm(Array.from({ length: 20 }, () => think));
    const out = await runAgent(baseInput, ctx, llm);
    expect(out.iterations).toBe(4);
    expect(out.reasoningSteps).toHaveLength(5);
    expect(out.answer.isClarification).toBe(true);
    expect(out.answer.text).toMatch(/tool budget/);
  });

  it('rejects a think action missing summary as a parse error', async () => {
    const llm = scriptedLlm([
      JSON.stringify({ action: 'think' }),
      JSON.stringify({
        action: 'answer',
        text: 'recovered',
        sources: [{ kind: 'patient', id: 'pat-1', label: 'Patient' }],
      }),
    ]);
    const out = await runAgent(baseInput, ctx, llm);
    expect(out.iterations).toBe(2);
    expect(out.reasoningSteps).toHaveLength(0);
    expect(out.answer.text).toBe('recovered');
  });

  it('stub-mode returns empty reasoning chain (no think synthesis)', async () => {
    const llm = scriptedLlm([{ stub: true, text: 'irrelevant' }]);
    const out = await runAgent(baseInput, ctx, llm);
    expect(out.reasoningSteps).toEqual([]);
    expect(out.stub).toBe(true);
  });

  it('drops invalid source entries (kind / id / label malformed)', async () => {
    const llm = scriptedLlm([
      JSON.stringify({
        action: 'answer',
        text: 'Mixed sources.',
        sources: [
          { kind: 'note', id: 'good', label: 'Good' },
          { kind: 'invalid-kind', id: 'bad', label: 'Bad' },
          { kind: 'follow-up', id: 'good-fu' }, // missing label
        ],
      }),
    ]);
    const out = await runAgent(baseInput, ctx, llm);
    expect(out.answer.sources).toHaveLength(1);
    expect(out.answer.sources[0]!.id).toBe('good');
  });
});
