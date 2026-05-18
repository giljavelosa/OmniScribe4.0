import { describe, it, expect } from 'vitest';
import {
  assertProviderAllowedForPHI,
  PhiProviderViolationError,
  phiAllowedProviders,
} from '@/services/llm/phi-guard';

describe('assertProviderAllowedForPHI', () => {
  it('lists exactly bedrock + vllm in the allowlist', () => {
    expect(phiAllowedProviders).toEqual(['bedrock', 'vllm']);
  });

  it('allows bedrock + vllm without throwing', () => {
    expect(() => assertProviderAllowedForPHI('bedrock')).not.toThrow();
    expect(() => assertProviderAllowedForPHI('vllm')).not.toThrow();
  });

  it('throws PhiProviderViolationError for non-allowed providers', () => {
    for (const p of ['openai', 'openrouter', 'anthropic-direct'] as const) {
      expect(() => assertProviderAllowedForPHI(p)).toThrow(PhiProviderViolationError);
    }
  });

  it('error message names the offending provider + the allowlist', () => {
    try {
      assertProviderAllowedForPHI('openai');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('openai');
      expect(msg).toContain('bedrock');
      expect(msg).toContain('vllm');
    }
  });
});
