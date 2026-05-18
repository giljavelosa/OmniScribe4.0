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
