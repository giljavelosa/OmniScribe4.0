/**
 * writeLlmCallLog — Unit 35.
 *
 * Sole writer for the LlmCallLog table. Called from the LLM service
 * wrapper (`src/services/llm/index.ts`) after every generate call when
 * the caller passed `opts.meter`. Fail-loud per Rule 8: if the DB
 * write fails, the caller's request fails (no swallowed errors).
 *
 * PHI-free by construction: the function signature has no prompt /
 * response fields. The model id + token counts + caller-supplied
 * surface tag are the only payload.
 *
 * Cost is computed here (via MODEL_PRICING) + stored on the row so
 * future pricing edits don't silently revise history.
 */

import { prisma } from '@/lib/prisma';
import { computeCostUsd } from './pricing';

export type LlmCallLogInput = {
  orgId: string;
  noteId?: string;
  /** Caller-supplied surface tag, e.g. 'copilot.ask', 'worker.brief'. */
  surface: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  stub?: boolean;
};

export async function writeLlmCallLog(input: LlmCallLogInput): Promise<void> {
  const costUsd = computeCostUsd(input.model, input.tokensIn, input.tokensOut);
  await prisma.llmCallLog.create({
    data: {
      orgId: input.orgId,
      noteId: input.noteId,
      surface: input.surface,
      model: input.model,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      costUsd,
      latencyMs: input.latencyMs,
      stub: input.stub ?? false,
    },
  });
}
