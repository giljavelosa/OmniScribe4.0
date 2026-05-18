import { describe, it, expect } from 'vitest';

import {
  evaluateDateOfService,
  LATE_ENTRY_MAX_DAYS,
} from '@/lib/encounters/late-entry';

/**
 * Late-entry charting — date validation + isLateEntry / day-gap computation.
 *
 * Spec: context/specs/late-entry-charting.md
 *
 * Covers the boundary cases the spec calls out explicitly:
 *   - dateOfService = today                  → ok, isLateEntry=false, gap=0
 *   - dateOfService = today - 1d             → ok, isLateEntry=true, gap=1
 *   - dateOfService = today - 14d            → ok, isLateEntry=true, gap=14
 *   - dateOfService = today - 30d            → ok, isLateEntry=true, gap=30
 *   - dateOfService = today - 31d            → reject, too_far_back
 *   - dateOfService = today + 1d             → reject, future_date
 *   - unparseable                            → reject, invalid_date
 */

// Pin "now" to a stable local-midnight reference so the day-rounding math is
// deterministic regardless of TZ.
function pinnedNow(): Date {
  return new Date(2026, 4 /* May (0-indexed) */, 18, 14, 30, 0, 0);
}

function isoDaysAgo(days: number, now = pinnedNow()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

describe('evaluateDateOfService — boundary cases', () => {
  it('same calendar day → normal visit (isLateEntry=false, gap=0)', () => {
    const res = evaluateDateOfService({ iso: isoDaysAgo(0), now: pinnedNow() });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.isLateEntry).toBe(false);
      expect(res.lateEntryDaysGap).toBe(0);
    }
  });

  it('1 day back → late entry (gap=1)', () => {
    const res = evaluateDateOfService({ iso: isoDaysAgo(1), now: pinnedNow() });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.isLateEntry).toBe(true);
      expect(res.lateEntryDaysGap).toBe(1);
    }
  });

  it('14 days back → late entry (gap=14) — spec example', () => {
    const res = evaluateDateOfService({ iso: isoDaysAgo(14), now: pinnedNow() });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.isLateEntry).toBe(true);
      expect(res.lateEntryDaysGap).toBe(14);
    }
  });

  it('30 days back → still allowed (window floor inclusive)', () => {
    const res = evaluateDateOfService({
      iso: isoDaysAgo(LATE_ENTRY_MAX_DAYS),
      now: pinnedNow(),
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.isLateEntry).toBe(true);
      expect(res.lateEntryDaysGap).toBe(LATE_ENTRY_MAX_DAYS);
    }
  });

  it('31 days back → rejected with too_far_back', () => {
    const res = evaluateDateOfService({
      iso: isoDaysAgo(LATE_ENTRY_MAX_DAYS + 1),
      now: pinnedNow(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('too_far_back');
  });

  it('1 day in the future → rejected with future_date', () => {
    const res = evaluateDateOfService({ iso: isoDaysAgo(-1), now: pinnedNow() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('future_date');
  });

  it('60 days back → rejected with too_far_back (spec verification step)', () => {
    const res = evaluateDateOfService({ iso: isoDaysAgo(60), now: pinnedNow() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('too_far_back');
  });

  it('unparseable string → rejected with invalid_date', () => {
    const res = evaluateDateOfService({ iso: 'not-a-date', now: pinnedNow() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid_date');
  });

  it('time-of-day on a backdated day still rounds to whole-day gap', () => {
    // Build "13 days ago at 23:00" — should still bucket to gap=13, not 12.
    const now = pinnedNow();
    const d = new Date(now);
    d.setDate(d.getDate() - 13);
    d.setHours(23, 59, 0, 0);
    const res = evaluateDateOfService({ iso: d.toISOString(), now });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.lateEntryDaysGap).toBe(13);
  });
});
