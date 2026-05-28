import { describe, expect, it } from 'vitest';

import { contractExpiryWarning } from '@/lib/billing/monthly-allowance';

describe('contractExpiryWarning', () => {
  const now = new Date('2026-05-27T12:00:00Z');

  it('returns none when no contract end', () => {
    expect(contractExpiryWarning(null, now)).toEqual({
      daysLeft: Infinity,
      level: 'none',
    });
  });

  it('returns none when more than 30 days remain', () => {
    const end = new Date('2026-07-01T00:00:00Z');
    expect(contractExpiryWarning(end, now).level).toBe('none');
  });

  it('returns warn between 8 and 30 days', () => {
    const end = new Date('2026-06-15T00:00:00Z');
    const result = contractExpiryWarning(end, now);
    expect(result.level).toBe('warn');
    expect(result.daysLeft).toBeGreaterThan(7);
    expect(result.daysLeft).toBeLessThanOrEqual(30);
  });

  it('returns urgent at 7 days or fewer', () => {
    const end = new Date('2026-06-01T00:00:00Z');
    expect(contractExpiryWarning(end, now).level).toBe('urgent');
  });
});
