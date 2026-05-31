/**
 * LLM abstraction types (spec §A).
 *
 * Anti-regression rule 6: all AI calls go through src/services/llm/. No
 * direct @aws-sdk/client-bedrock-runtime or openai imports outside this
 * folder (ESLint enforces from PR #1).
 *
 * PHI guard: when `phi: true`, the wrapper in index.ts asserts the active
 * provider is in PHI_ALLOWED_PROVIDERS before any call lands at the model.
 */

export type Provider = 'bedrock' | 'vllm' | 'openai' | 'openrouter' | 'anthropic-direct';

export type ImageBlock = {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  /** Base64-encoded image bytes, without a data: URL prefix. */
  data: string;
  /** Optional provenance label for model-facing prompts and tests. */
  label?: string;
  /** 1-indexed source page when the image came from a document. */
  sourcePage?: number;
};

export interface GenerateOptions {
  /** Marks the call as carrying PHI. Triggers assertProviderAllowedForPHI. */
  phi: boolean;
  /** Default 0 — clinical generation is deterministic. */
  temperature?: number;
  maxTokens?: number;
  /** sonnet (default) or haiku (faster + cheaper; used on retry / fast paths). */
  model?: 'sonnet' | 'haiku';
  /** Hint to the provider to return strict JSON when supported. */
  jsonMode?: boolean;
  /** Claude vision inputs. Streaming remains text-only; use generate(). */
  images?: ImageBlock[];
  /** Correlation id surfaced in inferenceLog for traceability. */
  requestId?: string;
  /**
   * Unit 35 — when present, the LLM service writes one `LlmCallLog`
   * row after the call returns. OPTIONAL: callers without org context
   * (test stubs, ad-hoc scripts) omit it + their calls aren't logged.
   * Fail-safe: missing meter = rollup undercounts; never throws.
   *
   * `surface` is a caller-supplied dotted tag (`copilot.ask`,
   * `worker.brief`, `copilot.draft.patientMessage`) so the rollup
   * can group by call origin.
   */
  meter?: {
    orgId: string;
    noteId?: string;
    surface: string;
  };
}

export interface GenerateResult {
  text: string;
  model: string;
  region?: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  /** Indicates whether the provider was the stub fallback (no key configured). */
  stub?: boolean;
}

export interface GenerateChunk {
  delta: string;
  done?: boolean;
}

export interface LLMService {
  generate(systemPrompt: string, userPrompt: string, opts?: GenerateOptions): Promise<GenerateResult>;
  generateStream(systemPrompt: string, userPrompt: string, opts?: GenerateOptions): AsyncIterable<GenerateChunk>;
}
