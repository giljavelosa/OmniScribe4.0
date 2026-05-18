import { describe, expect, it } from 'vitest';

import { FHIR_STALE_AFTER_MS, isStale } from '@/lib/fhir/staleness';

describe('isStale', () => {
  const now = new Date('2026-05-17T12:00:00Z');

  it('returns false for a fresh fetch', () => {
    const fetchedAt = new Date('2026-05-16T12:00:00Z');
    expect(isStale(fetchedAt, now)).toBe(false);
  });

  it('returns false at exactly the threshold (inclusive cap)', () => {
    const fetchedAt = new Date(now.getTime() - FHIR_STALE_AFTER_MS);
    expect(isStale(fetchedAt, now)).toBe(false);
  });

  it('returns true one millisecond past the threshold', () => {
    const fetchedAt = new Date(now.getTime() - FHIR_STALE_AFTER_MS - 1);
    expect(isStale(fetchedAt, now)).toBe(true);
  });

  it('returns true for a very old fetch', () => {
    const fetchedAt = new Date('2024-01-01T00:00:00Z');
    expect(isStale(fetchedAt, now)).toBe(true);
  });

  it('threshold is 7 days', () => {
    expect(FHIR_STALE_AFTER_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
