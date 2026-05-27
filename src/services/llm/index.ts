/**
 * LLM service router (spec §A).
 *
 * Anti-regression rule 6: this is THE only place that decides which provider
 * runs. App code calls getLLMService().generate(...) — the provider name is
 * never exposed to callers. PHI guard is wrapped around every call when
 * opts.phi === true.
 *
 * Stub fallback: if no provider works, the bedrock service returns a stub
 * response (so unit tests + local dev without a Bedrock token still
 * exercise end-to-end). The PHI guard still runs — a stubbed Bedrock is
 * Bedrock from the allowlist's perspective; openai/openrouter are still
 * banned.
 */

import { BedrockService } from './bedrock';
import { assertProviderAllowedForPHI } from './phi-guard';
import { writeLlmCallLog } from '@/lib/llm/cost-log';
import type {
  GenerateChunk,
  GenerateResult,
  LLMService,
  Provider,
} from './types';

const activeProvider: Provider = (process.env.LLM_PROVIDER as Provider | undefined) ?? 'bedrock';

let cached: LLMService | null = null;

function buildBase(): LLMService {
  switch (activeProvider) {
    case 'bedrock':
      return new BedrockService();
    // Other providers (vllm/openai/openrouter/anthropic-direct) intentionally
    // not implemented in Unit 05. Bedrock is the canonical PHI-allowed
    // provider; vllm lands when we stand up the self-hosted fallback.
    default:
      throw new Error(
        `LLM_PROVIDER=${activeProvider} not implemented. Only "bedrock" is wired in Unit 05.`,
      );
  }
}

function getBase(): LLMService {
  if (!cached) cached = buildBase();
  return cached;
}

/**
 * THE only public entry point for LLM calls. Wraps the active provider with
 * the PHI guard.
 */
export function getLLMService(): LLMService {
  const base = getBase();
  return {
    async generate(sys, user, opts): Promise<GenerateResult> {
      if (opts?.phi) assertProviderAllowedForPHI(activeProvider);
      const result = await base.generate(sys, user, opts);
      // Unit 35 — write per-call accounting when the caller passed a
      // meter. Fail-loud (Rule 8): if the write throws, the request
      // fails. Callers without meter context (test stubs) skip the
      // write entirely; rollup undercounts those calls.
      if (opts?.meter) {
        await writeLlmCallLog({
          orgId: opts.meter.orgId,
          noteId: opts.meter.noteId,
          surface: opts.meter.surface,
          model: result.model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          latencyMs: result.latencyMs,
          stub: !!result.stub,
        });
      }
      return result;
    },
    async *generateStream(sys, user, opts): AsyncIterable<GenerateChunk> {
      if (opts?.phi) assertProviderAllowedForPHI(activeProvider);
      // generateStream is metered at the caller layer when needed —
      // the stream's final token tally lives in the caller's accumulator.
      yield* base.generateStream(sys, user, opts);
    },
    // Sprint 0.19 / Tier 13 — vision extraction wrapper. Mirrors the
    // PHI + meter semantics of `generate`. If the underlying provider
    // doesn't implement it (e.g. a stub or non-vision endpoint),
    // surface a typed error so the caller can decide whether to fail
    // the upload extraction or fall back to OCR-only.
    extractFromImage: base.extractFromImage
      ? async (sys, user, opts) => {
          if (opts.phi) assertProviderAllowedForPHI(activeProvider);
          const result = await base.extractFromImage!(sys, user, opts);
          if (opts.meter) {
            await writeLlmCallLog({
              orgId: opts.meter.orgId,
              noteId: opts.meter.noteId,
              surface: opts.meter.surface,
              model: result.model,
              tokensIn: result.tokensIn,
              tokensOut: result.tokensOut,
              latencyMs: result.latencyMs,
              stub: !!result.stub,
            });
          }
          return result;
        }
      : undefined,
  };
}

export { assertProviderAllowedForPHI, PhiProviderViolationError, phiAllowedProviders } from './phi-guard';
export { bedrockConfig } from './bedrock';
export type {
  Provider,
  GenerateOptions,
  GenerateChunk,
  GenerateResult,
  LLMService,
  ExtractFromImageOptions,
} from './types';

export const llmConfig = {
  activeProvider,
};
