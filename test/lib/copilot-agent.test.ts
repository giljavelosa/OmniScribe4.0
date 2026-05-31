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

  it('refunds the first parse-error iteration then returns answer', async () => {
    // Phase 1A: a single JSON-mode hiccup must not tax the model's
    // tool budget. iterations === 1 after the refund (1 attempt
    // refunded + 1 successful answer turn that landed at slot 1).
    const llm = scriptedLlm([
      'not valid JSON at all',
      JSON.stringify({
        action: 'answer',
        text: 'Recovered after parse retry.',
        sources: [{ kind: 'patient', id: 'pat-1', label: 'Patient' }],
      }),
    ]);
    const out = await runAgent(baseInput, ctx, llm);
    expect(out.iterations).toBe(1);
    expect(out.answer.text).toBe('Recovered after parse retry.');
  });

  it('does not refund a second parse error (refund cap = 1)', async () => {
    // Phase 1A: second parse failure consumes its iteration so a model
    // that keeps emitting non-JSON still terminates within MAX_ITERATIONS.
    const llm = scriptedLlm([
      'first garbage',
      'second garbage',
      JSON.stringify({
        action: 'answer',
        text: 'Recovered eventually.',
        sources: [{ kind: 'patient', id: 'pat-1', label: 'Patient' }],
      }),
    ]);
    const out = await runAgent(baseInput, ctx, llm);
    // 1st parse fail refunded (iterations net 0), 2nd parse fail
    // consumed (iterations net 1), answer succeeded (iterations net 2).
    expect(out.iterations).toBe(2);
    expect(out.answer.text).toBe('Recovered eventually.');
  });

  it('strips a markdown ```json``` fence around the JSON envelope', async () => {
    // Phase 1A: Sonnet occasionally wraps JSON-mode output in a fence
    // despite the jsonMode flag. The agent must transparently unwrap.
    const fenced =
      '```json\n' +
      JSON.stringify({
        action: 'answer',
        text: 'Fenced answer.',
        sources: [{ kind: 'patient', id: 'pat-1', label: 'Patient' }],
      }) +
      '\n```';
    const llm = scriptedLlm([fenced]);
    const out = await runAgent(baseInput, ctx, llm);
    expect(out.iterations).toBe(1);
    expect(out.answer.text).toBe('Fenced answer.');
    expect(out.answer.isClarification).toBe(false);
  });

  it('strips a bare ``` (no language tag) fence around the JSON envelope', async () => {
    const fenced =
      '```\n' +
      JSON.stringify({
        action: 'answer',
        text: 'Bare-fence answer.',
        sources: [{ kind: 'patient', id: 'pat-1', label: 'Patient' }],
      }) +
      '\n```';
    const llm = scriptedLlm([fenced]);
    const out = await runAgent(baseInput, ctx, llm);
    expect(out.answer.text).toBe('Bare-fence answer.');
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

  it('allows chart mode to call the medication-reference tool and cite it as literature', async () => {
    const llm = scriptedLlm([
      JSON.stringify({
        action: 'tool',
        tool: 'lookupMedicationReference',
        args: { medicationName: 'losartan' },
      }),
      JSON.stringify({
        action: 'answer',
        text: 'General reference guidance for adult hypertension lists losartan 50 mg once daily, with lower-start considerations for volume depletion or hepatic impairment.',
        sources: [
          { kind: 'literature', id: 'dailymed:losartan-potassium', label: 'DailyMed losartan potassium label' },
          { kind: 'patient', id: 'pat-1', label: 'Patient context' },
        ],
      }),
    ]);

    const out = await runAgent(
      { ...baseInput, mode: 'chart', question: 'losartan adult hypertension reference?' },
      ctx,
      llm,
    );

    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0]).toMatchObject({
      tool: 'lookupMedicationReference',
      resultOk: true,
      rowCount: 1,
    });
    expect(out.answer.sources.map((source) => source.kind)).toEqual(['literature', 'patient']);
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

  it('rejects a think action missing summary as a parse error (first refunded)', async () => {
    const llm = scriptedLlm([
      JSON.stringify({ action: 'think' }),
      JSON.stringify({
        action: 'answer',
        text: 'recovered',
        sources: [{ kind: 'patient', id: 'pat-1', label: 'Patient' }],
      }),
    ]);
    const out = await runAgent(baseInput, ctx, llm);
    // Phase 1A — first parse failure is refunded, so iterations === 1.
    expect(out.iterations).toBe(1);
    expect(out.reasoningSteps).toHaveLength(0);
    expect(out.answer.text).toBe('recovered');
  });

  it('stub-mode returns empty reasoning chain (no think synthesis)', async () => {
    const llm = scriptedLlm([{ stub: true, text: 'irrelevant' }]);
    const out = await runAgent(baseInput, ctx, llm);
    expect(out.reasoningSteps).toEqual([]);
    expect(out.stub).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────
  // Phase 1B — research-mode LLM-knowledge fallback
  // ──────────────────────────────────────────────────────────────────

  it('research mode: answer-from-knowledge returns isLLMKnowledge + synthetic llm-intrinsic source', async () => {
    const llm = scriptedLlm([
      // First, model calls a research tool that comes up empty (stub
      // fixtures still return rows, but the test only cares about
      // dispatch shape — see the route's behavior end-to-end).
      JSON.stringify({
        action: 'tool',
        tool: 'searchPMC',
        args: { query: 'tirzepatide starting dose' },
      }),
      // Then it falls back to training knowledge.
      JSON.stringify({
        action: 'answer-from-knowledge',
        text: 'Tirzepatide typically starts at 2.5 mg subcut weekly, titrated monthly.',
        topic: 'tirzepatide dosing',
      }),
    ]);
    const out = await runAgent(
      { ...baseInput, mode: 'research', question: 'starting dose for tirzepatide?' },
      ctx,
      llm,
    );
    expect(out.answer.isLLMKnowledge).toBe(true);
    expect(out.answer.isClarification).toBe(false);
    expect(out.answer.sources).toEqual([
      { kind: 'llm-intrinsic', id: 'sonnet-4-5', label: 'LLM training knowledge' },
    ]);
    expect(out.answer.text).toMatch(/tirzepatide/i);
  });

  it('chart mode: answer-from-knowledge is rejected with wrong_mode_fallback (no LLM-knowledge leak)', async () => {
    // Phase 1B fail-closed: a model that tries to fall back from chart
    // mode must NEVER return an LLM-knowledge answer. The agent
    // injects a wrong_mode_fallback tool-result and the loop continues
    // until the model produces a real source-grounded answer (or hits
    // the budget-exhausted clarification).
    const llm = scriptedLlm([
      JSON.stringify({
        action: 'answer-from-knowledge',
        text: 'General medical knowledge on ACL recovery says…',
        topic: 'ACL recovery',
      }),
      JSON.stringify({
        action: 'answer',
        text: 'I need to look that up against the chart.',
        sources: [{ kind: 'patient', id: 'pat-1', label: 'Patient' }],
      }),
    ]);
    const out = await runAgent({ ...baseInput, mode: 'chart' }, ctx, llm);
    expect(out.answer.isLLMKnowledge).toBe(false);
    expect(out.answer.sources[0]?.kind).toBe('patient');
    expect(out.answer.sources.find((s) => s.kind === 'llm-intrinsic')).toBeUndefined();
  });

  it('parser rejects answer-from-knowledge missing text or topic', async () => {
    // Missing text → parse error → refunded once, second valid answer
    // lands at iterations=1.
    const llm = scriptedLlm([
      JSON.stringify({ action: 'answer-from-knowledge', topic: 'x' }),
      JSON.stringify({
        action: 'answer-from-knowledge',
        text: 'recovered',
        topic: 'x',
      }),
    ]);
    const out = await runAgent(
      { ...baseInput, mode: 'research', question: 'q' },
      ctx,
      llm,
    );
    expect(out.iterations).toBe(1);
    expect(out.answer.isLLMKnowledge).toBe(true);
    expect(out.answer.text).toBe('recovered');
  });

  it('truncates answer-from-knowledge topic at 80 chars', async () => {
    const longTopic = 't'.repeat(200);
    const llm = scriptedLlm([
      JSON.stringify({
        action: 'answer-from-knowledge',
        text: 'short answer',
        topic: longTopic,
      }),
    ]);
    const out = await runAgent(
      { ...baseInput, mode: 'research', question: 'q' },
      ctx,
      llm,
    );
    // The parser truncates topic to 80; we don't surface topic in the
    // answer envelope, but the action must still resolve cleanly.
    expect(out.answer.isLLMKnowledge).toBe(true);
    expect(out.answer.text).toBe('short answer');
  });

  it('non-fallback research answers leave isLLMKnowledge false', async () => {
    const llm = scriptedLlm([
      JSON.stringify({
        action: 'answer',
        text: 'Literature says X.',
        sources: [{ kind: 'literature', id: 'PMC1', label: 'Smith 2024 (NEJM)' }],
      }),
    ]);
    const out = await runAgent(
      { ...baseInput, mode: 'research', question: 'q' },
      ctx,
      llm,
    );
    expect(out.answer.isLLMKnowledge).toBe(false);
    expect(out.answer.sources[0]?.kind).toBe('literature');
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
