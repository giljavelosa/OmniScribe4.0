/**
 * LLM model pricing map + cost compute — Unit 35.
 *
 * Centralized so a price change is one edit, not a sweep across 5+
 * caller surfaces. Costs are computed at the time of the LLM call and
 * STORED on `LlmCallLog.costUsd` (not recomputed on read) so historical
 * rows reflect the price AT THE TIME of the call — matches accounting
 * reality, insulates the rollup from future price edits.
 *
 * When the model id isn't in the map, falls back to a conservative
 * `unknown` entry. Better fail-loud (cost looks higher than expected)
 * than fail-silent (rollup zeros out untracked model bumps).
 *
 * Source: AWS Bedrock pricing page, cross-region inference profile
 * tier (the `us.` prefix on the model id maps to this tier). Update
 * this file when AWS publishes new pricing.
 */

export type ModelPricing = {
  /** USD per million input tokens. */
  inUsdPerMTok: number;
  /** USD per million output tokens. */
  outUsdPerMTok: number;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Bedrock cross-region inference profile (us.* prefix). Sonnet 4.5
  // + Haiku 4.5 are the two models OmniScribe routes through; older
  // Sonnet/Haiku versions may appear in historical rows if a fleet
  // rolls forward — entries are append-only so old rows still resolve.
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0': { inUsdPerMTok: 3, outUsdPerMTok: 15 },
  'us.anthropic.claude-haiku-4-5-20251001-v1:0': { inUsdPerMTok: 1, outUsdPerMTok: 5 },
  // Fallback for unknown model ids. Conservative on the high side so
  // an unexpected model bump shows up as an overcharge in the
  // rollup, not as zero cost.
  unknown: { inUsdPerMTok: 10, outUsdPerMTok: 30 },
};

/**
 * Compute the USD cost of a single LLM call from the model id +
 * token counts the provider returned. Returns 0 for zero-token stub
 * responses; never throws (unknown models hit the fallback entry).
 */
export function computeCostUsd(
  model: string,
  tokensIn: number,
  tokensOut: number,
): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING.unknown!;
  const cost =
    (tokensIn * pricing.inUsdPerMTok + tokensOut * pricing.outUsdPerMTok) /
    1_000_000;
  // Round to 4 decimal places (matches LlmCallLog.costUsd Decimal(12,4)
  // precision). Avoids JS float artifacts like 0.000299999 → 0.0003.
  return Math.round(cost * 10_000) / 10_000;
}
