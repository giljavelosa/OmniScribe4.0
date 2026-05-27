import { describe, it, expect } from 'vitest';

import {
  intentMatchesCase,
  nominateCases,
  recencyBonus,
  type NominatorCase,
} from '@/services/copilot/case-nominator';

const FROZEN_NOW = new Date('2026-05-27T16:00:00Z');

function mkCase(overrides: Partial<NominatorCase>): NominatorCase {
  return {
    id: 'case_default',
    primaryIcd: null,
    primaryIcdLabel: 'Unspecified',
    secondaryIcd: null,
    viewerLastActivityAt: null,
    viewerDivisionLastActivityAt: null,
    lastActivityAt: null,
    ...overrides,
  };
}

function isoDaysAgo(n: number): string {
  return new Date(FROZEN_NOW.getTime() - n * 86_400_000).toISOString();
}

describe('recencyBonus', () => {
  it('returns 0 for null', () => {
    expect(recencyBonus(null, FROZEN_NOW)).toBe(0);
  });

  it('returns 0 for invalid date string', () => {
    expect(recencyBonus('not-a-date', FROZEN_NOW)).toBe(0);
  });

  it('maps days-since to the documented scale', () => {
    expect(recencyBonus(isoDaysAgo(0), FROZEN_NOW)).toBe(9);
    expect(recencyBonus(isoDaysAgo(1), FROZEN_NOW)).toBe(8);
    expect(recencyBonus(isoDaysAgo(3), FROZEN_NOW)).toBe(7);
    expect(recencyBonus(isoDaysAgo(7), FROZEN_NOW)).toBe(6);
    expect(recencyBonus(isoDaysAgo(14), FROZEN_NOW)).toBe(5);
    expect(recencyBonus(isoDaysAgo(30), FROZEN_NOW)).toBe(4);
    expect(recencyBonus(isoDaysAgo(60), FROZEN_NOW)).toBe(3);
    expect(recencyBonus(isoDaysAgo(90), FROZEN_NOW)).toBe(2);
    expect(recencyBonus(isoDaysAgo(180), FROZEN_NOW)).toBe(1);
    expect(recencyBonus(isoDaysAgo(365), FROZEN_NOW)).toBe(0);
  });
});

describe('intentMatchesCase', () => {
  it('returns null when intent is null', () => {
    expect(intentMatchesCase(null, { primaryIcd: 'M54.50', secondaryIcd: null })).toBeNull();
  });

  it('returns the matched primary ICD when prefix matches', () => {
    expect(
      intentMatchesCase('REHAB_PROGRESS_NOTE', { primaryIcd: 'M54.50', secondaryIcd: null }),
    ).toBe('M54.50');
  });

  it('falls back to secondary ICD when primary does not match', () => {
    expect(
      intentMatchesCase('REHAB_INITIAL_EVAL', { primaryIcd: 'E11.9', secondaryIcd: 'S83.5' }),
    ).toBe('S83.5');
  });

  it('returns null when no ICD prefix matches the intent', () => {
    expect(
      intentMatchesCase('REHAB_PROGRESS_NOTE', { primaryIcd: 'E11.9', secondaryIcd: 'F41.1' }),
    ).toBeNull();
  });

  it('returns null when both ICDs are null', () => {
    expect(
      intentMatchesCase('REHAB_PROGRESS_NOTE', { primaryIcd: null, secondaryIcd: null }),
    ).toBeNull();
  });

  it('UNSPECIFIED never matches', () => {
    expect(
      intentMatchesCase('UNSPECIFIED', { primaryIcd: 'M54.50', secondaryIcd: null }),
    ).toBeNull();
  });

  it('matches BH intent to F-prefix ICDs', () => {
    expect(
      intentMatchesCase('BH_SESSION_INDIVIDUAL', { primaryIcd: 'F41.1', secondaryIcd: null }),
    ).toBe('F41.1');
  });

  it('matches Annual Wellness to Z00/Z01', () => {
    expect(
      intentMatchesCase('MEDICAL_ANNUAL_WELLNESS', { primaryIcd: 'Z00.00', secondaryIcd: null }),
    ).toBe('Z00.00');
  });
});

describe('nominateCases', () => {
  it('returns empty result for no cases', () => {
    const r = nominateCases({ cases: [], viewerDivision: 'REHAB' }, FROZEN_NOW);
    expect(r.nominee).toBeNull();
    expect(r.ranked).toEqual([]);
  });

  it('nominates the only case when there is one', () => {
    const c = mkCase({
      id: 'case_1',
      primaryIcd: 'M54.50',
      primaryIcdLabel: 'Low back pain',
      viewerLastActivityAt: isoDaysAgo(3),
    });
    const r = nominateCases({ cases: [c], viewerDivision: 'REHAB' }, FROZEN_NOW);
    expect(r.nominee?.id).toBe('case_1');
    expect(r.nominee?.score).toBeGreaterThan(0);
  });

  it('INTENT MATCH beats VIEWER RECENCY when scores would otherwise tie', () => {
    // case A: intent match (M54.50) but stale viewer activity
    const caseA = mkCase({
      id: 'case_A',
      primaryIcd: 'M54.50',
      primaryIcdLabel: 'Low back pain',
      viewerLastActivityAt: isoDaysAgo(60),
    });
    // case B: no intent match (E11.9 diabetes) but FRESH viewer activity
    const caseB = mkCase({
      id: 'case_B',
      primaryIcd: 'E11.9',
      primaryIcdLabel: 'Type 2 diabetes',
      viewerLastActivityAt: isoDaysAgo(1),
    });
    const r = nominateCases(
      {
        cases: [caseB, caseA],
        viewerDivision: 'REHAB',
        proposedIntent: 'REHAB_PROGRESS_NOTE',
      },
      FROZEN_NOW,
    );
    // Intent match should win the nomination even though B is more recent.
    expect(r.nominee?.id).toBe('case_A');
    expect(r.nominee?.reason).toContain('Recent intent match');
    expect(r.nominee?.reason).toContain('M54.50');
  });

  it('falls back to VIEWER RECENCY when no intent match exists', () => {
    const caseFresh = mkCase({
      id: 'case_fresh',
      primaryIcd: 'E11.9',
      primaryIcdLabel: 'Type 2 diabetes',
      viewerLastActivityAt: isoDaysAgo(2),
    });
    const caseStale = mkCase({
      id: 'case_stale',
      primaryIcd: 'Z00.00',
      primaryIcdLabel: 'General exam',
      viewerLastActivityAt: isoDaysAgo(40),
    });
    const r = nominateCases(
      {
        cases: [caseStale, caseFresh],
        viewerDivision: 'MEDICAL',
        proposedIntent: 'MEDICAL_FOLLOW_UP', // no affinity prefixes
      },
      FROZEN_NOW,
    );
    expect(r.nominee?.id).toBe('case_fresh');
    expect(r.nominee?.reason).toContain('Your active case');
  });

  it('falls back to DIVISION RECENCY when viewer has no own activity', () => {
    const caseDivRecent = mkCase({
      id: 'case_div',
      viewerDivisionLastActivityAt: isoDaysAgo(2),
    });
    const caseOverallOnly = mkCase({
      id: 'case_overall',
      lastActivityAt: isoDaysAgo(1),
    });
    const r = nominateCases(
      { cases: [caseOverallOnly, caseDivRecent], viewerDivision: 'BEHAVIORAL_HEALTH' },
      FROZEN_NOW,
    );
    expect(r.nominee?.id).toBe('case_div');
    expect(r.nominee?.reason).toContain('BEHAVIORAL_HEALTH');
  });

  it('uses OVERALL recency when nothing else is available', () => {
    const c = mkCase({ id: 'case_only', lastActivityAt: isoDaysAgo(10) });
    const r = nominateCases({ cases: [c], viewerDivision: null }, FROZEN_NOW);
    expect(r.nominee?.id).toBe('case_only');
    expect(r.nominee?.reason).toContain('Most recent activity');
  });

  it('scores a case with NO signals at 0 and still includes it in the ranked list', () => {
    const c = mkCase({ id: 'case_empty' });
    const r = nominateCases({ cases: [c], viewerDivision: 'REHAB' }, FROZEN_NOW);
    expect(r.ranked).toHaveLength(1);
    expect(r.nominee?.score).toBe(0);
    expect(r.nominee?.reason).toBe('No recent activity');
  });

  it('returns ranked cases sorted by score desc', () => {
    const intent = mkCase({
      id: 'intent',
      primaryIcd: 'M54.50',
      viewerLastActivityAt: isoDaysAgo(2),
    });
    const viewerRecent = mkCase({ id: 'viewer', viewerLastActivityAt: isoDaysAgo(1) });
    const overall = mkCase({ id: 'overall', lastActivityAt: isoDaysAgo(1) });
    const r = nominateCases(
      {
        cases: [overall, intent, viewerRecent],
        viewerDivision: 'REHAB',
        proposedIntent: 'REHAB_INITIAL_EVAL',
      },
      FROZEN_NOW,
    );
    expect(r.ranked.map((c) => c.id)).toEqual(['intent', 'viewer', 'overall']);
  });

  it('nominee.reason is always a non-empty string', () => {
    const cases = [
      mkCase({ id: 'a' }),
      mkCase({ id: 'b', viewerLastActivityAt: isoDaysAgo(1) }),
      mkCase({
        id: 'c',
        primaryIcd: 'M54.50',
        viewerLastActivityAt: isoDaysAgo(0),
      }),
    ];
    for (const c of cases) {
      const r = nominateCases(
        { cases: [c], viewerDivision: 'REHAB', proposedIntent: 'REHAB_PROGRESS_NOTE' },
        FROZEN_NOW,
      );
      expect(r.nominee?.reason).toBeTruthy();
      expect(typeof r.nominee?.reason).toBe('string');
    }
  });
});
