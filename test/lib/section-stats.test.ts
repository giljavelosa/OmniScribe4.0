import { describe, it, expect } from 'vitest';

import { percentile } from '@/lib/notes/section-status';

describe('percentile', () => {
  it('returns null for an empty array', () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it('returns the single value when length is 1', () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.95)).toBe(42);
  });

  it('computes median (p50) for an odd-length sorted set', () => {
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
  });

  it('computes p95 with a step-function index', () => {
    // 20 values: floor(0.95 * 20) = 19 → sorted[19] = 200
    const values = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
    expect(percentile(values, 0.95)).toBe(200);
  });

  it('handles unsorted input by sorting internally', () => {
    expect(percentile([50, 10, 30, 40, 20], 0.5)).toBe(30);
  });
});
