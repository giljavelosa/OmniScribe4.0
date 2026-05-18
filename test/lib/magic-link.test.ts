import { describe, it, expect } from 'vitest';

import {
  generateMagicToken,
  computeMagicExpiresAt,
  verifyDobAgainst,
  isExpired,
} from '@/lib/telehealth/magic-link';

describe('generateMagicToken', () => {
  it('returns a 22-char URL-safe base64 token', () => {
    for (let i = 0; i < 10; i++) {
      const tok = generateMagicToken();
      expect(tok.length).toBe(22);
      expect(tok).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it('produces distinct tokens (collision-resistant via crypto.randomBytes)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(generateMagicToken());
    expect(set.size).toBe(100);
  });
});

describe('computeMagicExpiresAt', () => {
  it('picks issuedAt + 24h when the visit ends sooner', () => {
    const issuedAt = new Date('2026-05-17T10:00:00Z');
    const scheduledEnd = new Date('2026-05-17T11:00:00Z'); // 1h after issue
    // visit + 2h grace = 13:00; issue + 24h = next-day 10:00
    // → visit + 2h is earlier → that's the cap
    const expiresAt = computeMagicExpiresAt({ issuedAt, scheduledEnd });
    expect(expiresAt.toISOString()).toBe('2026-05-17T13:00:00.000Z');
  });

  it('picks scheduledEnd + 2h when issuedAt + 24h is sooner', () => {
    const issuedAt = new Date('2026-05-17T10:00:00Z');
    const scheduledEnd = new Date('2026-05-19T10:00:00Z'); // 2 days later
    // visit + 2h = 19th 12:00; issue + 24h = 18th 10:00
    // → issue + 24h is earlier → that's the cap
    const expiresAt = computeMagicExpiresAt({ issuedAt, scheduledEnd });
    expect(expiresAt.toISOString()).toBe('2026-05-18T10:00:00.000Z');
  });
});

describe('verifyDobAgainst', () => {
  it('matches an exact ISO YYYY-MM-DD against the stored Date', () => {
    const stored = new Date('1990-04-15T00:00:00Z');
    expect(verifyDobAgainst(stored, '1990-04-15')).toBe(true);
  });

  it('rejects malformed input', () => {
    const stored = new Date('1990-04-15');
    expect(verifyDobAgainst(stored, '04/15/1990')).toBe(false);
    expect(verifyDobAgainst(stored, '1990-4-15')).toBe(false);
    expect(verifyDobAgainst(stored, '')).toBe(false);
  });

  it('rejects mismatch', () => {
    const stored = new Date('1990-04-15');
    expect(verifyDobAgainst(stored, '1990-04-16')).toBe(false);
  });
});

describe('isExpired', () => {
  it('returns true when the expiration is in the past', () => {
    expect(isExpired(new Date('2020-01-01'), new Date('2026-01-01'))).toBe(true);
  });

  it('returns false when expiration is in the future', () => {
    expect(isExpired(new Date('2030-01-01'), new Date('2026-01-01'))).toBe(false);
  });
});
