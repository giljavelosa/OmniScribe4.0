import { describe, expect, it } from 'vitest';

import {
  FHIR_STALE_AFTER_MS,
  FHIR_VERY_STALE_AFTER_MS,
  isStale,
  stalenessTier,
} from '@/lib/fhir/staleness';

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

describe('stalenessTier', () => {
  const now = new Date('2026-05-17T12:00:00Z');

  it('returns fresh under 7 days', () => {
    expect(stalenessTier(new Date('2026-05-16T12:00:00Z'), now)).toBe('fresh');
  });

  it('returns stale between 7 and 30 days', () => {
    const oneSecondPast7d = new Date(now.getTime() - FHIR_STALE_AFTER_MS - 1);
    expect(stalenessTier(oneSecondPast7d, now)).toBe('stale');
    const twoWeeks = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    expect(stalenessTier(twoWeeks, now)).toBe('stale');
  });

  it('returns very_stale past 30 days', () => {
    const oneSecondPast30d = new Date(now.getTime() - FHIR_VERY_STALE_AFTER_MS - 1);
    expect(stalenessTier(oneSecondPast30d, now)).toBe('very_stale');
  });

  it('30-day threshold is 30 × 24h', () => {
    expect(FHIR_VERY_STALE_AFTER_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
