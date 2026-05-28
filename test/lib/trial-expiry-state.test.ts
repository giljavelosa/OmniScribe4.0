import { describe, expect, it } from 'vitest';

import { getTrialExpiryState } from '@/lib/billing/commercial-mode';

describe('getTrialExpiryState', () => {
  const now = new Date('2026-05-27T12:00:00Z');

  it('returns null for non-trial contracts', () => {
    expect(
      getTrialExpiryState(
        { commercialModel: 'ORG_VISIT_BANK', trialEndsAt: new Date('2026-06-01') },
        now,
      ),
    ).toBeNull();
  });

  it('marks expired trials', () => {
    expect(
      getTrialExpiryState(
        { commercialModel: 'TRIAL', trialEndsAt: new Date('2026-05-01') },
        now,
      ),
    ).toEqual({ expired: true, daysLeft: 0, urgent: true, warn: true });
  });

  it('returns urgent when 7 days or fewer remain', () => {
    const state = getTrialExpiryState(
      { commercialModel: 'TRIAL', trialEndsAt: new Date('2026-05-30') },
      now,
    );
    expect(state?.expired).toBe(false);
    expect(state?.urgent).toBe(true);
  });
});
