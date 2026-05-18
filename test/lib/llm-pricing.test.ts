import { describe, expect, it } from 'vitest';

import { MODEL_PRICING, computeCostUsd } from '@/lib/llm/pricing';

/**
 * MODEL_PRICING + computeCostUsd unit tests — Unit 35.
 *
 * Pure-function tests; no DB. Verifies the math rounds to 4 decimals,
 * unknown models hit the conservative fallback, and zero-token stub
 * responses correctly return $0.
 */

describe('computeCostUsd', () => {
  it('computes Sonnet 4.5 cost correctly', () => {
    // 1M input tokens at $3 + 1M output tokens at $15 = $18.
    expect(
      computeCostUsd(
        'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        1_000_000,
        1_000_000,
      ),
    ).toBe(18);
  });

  it('computes Haiku 4.5 cost correctly', () => {
    // 1M input at $1 + 1M output at $5 = $6.
    expect(
      computeCostUsd(
        'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        1_000_000,
        1_000_000,
      ),
    ).toBe(6);
  });

  it('returns 0 for zero-token stub responses', () => {
    expect(
      computeCostUsd('us.anthropic.claude-sonnet-4-5-20250929-v1:0', 0, 0),
    ).toBe(0);
  });

  it('falls back to the conservative unknown rate for unmapped models', () => {
    // 1M input at $10 + 1M output at $30 = $40.
    expect(computeCostUsd('definitely-not-a-real-model', 1_000_000, 1_000_000)).toBe(40);
  });

  it('rounds to 4 decimal places (matches Decimal(12,4) column)', () => {
    // 500 input at $3/MTok + 1000 output at $15/MTok =
    //   (500 * 3 + 1000 * 15) / 1_000_000 = 0.0165 (within precision)
    expect(
      computeCostUsd('us.anthropic.claude-sonnet-4-5-20250929-v1:0', 500, 1000),
    ).toBe(0.0165);
    // Below-precision call: 1 in + 1 out → 18 / 1_000_000 = 0.000018
    // Rounded to 4 decimals → 0 (below the column precision floor).
    expect(
      computeCostUsd('us.anthropic.claude-sonnet-4-5-20250929-v1:0', 1, 1),
    ).toBe(0);
    // Larger call lands cleanly: 100k input at $3 + 50k output at $15
    //   = (300_000 + 750_000) / 1_000_000 = $1.05
    expect(
      computeCostUsd('us.anthropic.claude-sonnet-4-5-20250929-v1:0', 100_000, 50_000),
    ).toBe(1.05);
  });

  it('produces decimals at sub-cent precision', () => {
    // Sonnet at typical Ask question size: 800 in, 400 out
    // (800 * 3 + 400 * 15) / 1_000_000 = 0.0084
    expect(
      computeCostUsd('us.anthropic.claude-sonnet-4-5-20250929-v1:0', 800, 400),
    ).toBe(0.0084);
  });
});

describe('MODEL_PRICING table', () => {
  it('includes the unknown fallback', () => {
    expect(MODEL_PRICING.unknown).toBeDefined();
    expect(MODEL_PRICING.unknown!.inUsdPerMTok).toBeGreaterThan(0);
    expect(MODEL_PRICING.unknown!.outUsdPerMTok).toBeGreaterThan(0);
  });

  it('Haiku is cheaper than Sonnet on both dimensions', () => {
    const sonnet = MODEL_PRICING['us.anthropic.claude-sonnet-4-5-20250929-v1:0']!;
    const haiku = MODEL_PRICING['us.anthropic.claude-haiku-4-5-20251001-v1:0']!;
    expect(haiku.inUsdPerMTok).toBeLessThan(sonnet.inUsdPerMTok);
    expect(haiku.outUsdPerMTok).toBeLessThan(sonnet.outUsdPerMTok);
  });

  it('output tokens are pricier than input tokens for every mapped model', () => {
    // Invariant: AWS Bedrock pricing always has output > input for Claude.
    for (const [name, p] of Object.entries(MODEL_PRICING)) {
      if (name === 'unknown') continue;
      expect(p.outUsdPerMTok).toBeGreaterThan(p.inUsdPerMTok);
    }
  });
});
