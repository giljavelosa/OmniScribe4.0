import type { Provider } from './types';

/**
 * Providers whose BAA covers PHI. Bedrock is covered by AWS's BAA when the
 * customer has signed it; vllm runs self-hosted inside the OmniScribe VPC.
 *
 * Anything else (openai, openrouter, anthropic-direct) is BANNED for PHI
 * calls at runtime — the wrapper in index.ts asserts this before any
 * model call when `opts.phi === true`.
 */
const PHI_ALLOWED_PROVIDERS: ReadonlyArray<Provider> = ['bedrock', 'vllm'];

export class PhiProviderViolationError extends Error {
  constructor(provider: Provider) {
    super(
      `Provider "${provider}" is not in the PHI allowlist (${PHI_ALLOWED_PROVIDERS.join(
        ', ',
      )}). Switch LLM_PROVIDER to bedrock or vllm before processing PHI.`,
    );
    this.name = 'PhiProviderViolationError';
  }
}

export function assertProviderAllowedForPHI(provider: Provider): void {
  if (!PHI_ALLOWED_PROVIDERS.includes(provider)) {
    throw new PhiProviderViolationError(provider);
  }
}

export const phiAllowedProviders = PHI_ALLOWED_PROVIDERS;
