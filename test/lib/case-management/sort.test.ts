import { describe, expect, it } from 'vitest';

import {
  isViewerActiveCase,
  sortCasesByViewerRecency,
  type ViewerRecencySignals,
} from '../../../src/lib/case-management/sort';

type Case = ViewerRecencySignals & { id: string };

function mkCase(
  id: string,
  viewer: string | null,
  division: string | null,
  overall: string | null,
): Case {
  return {
    id,
    viewerLastActivityAt: viewer,
    viewerDivisionLastActivityAt: division,
    lastActivityAt: overall,
  };
}

describe('sortCasesByViewerRecency', () => {
  it('returns empty for empty input', () => {
    expect(sortCasesByViewerRecency([])).toEqual([]);
  });

  it('returns single-element array unchanged', () => {
    const c = mkCase('only', '2026-05-22T10:00:00Z', null, null);
    expect(sortCasesByViewerRecency([c])).toEqual([c]);
  });

  it('puts cases with viewer activity ahead of cases without', () => {
    const withViewer = mkCase('with', '2026-05-20T00:00:00Z', null, null);
    const withoutViewer = mkCase(
      'without',
      null,
      '2026-05-22T00:00:00Z',
      '2026-05-22T00:00:00Z',
    );
    const sorted = sortCasesByViewerRecency([withoutViewer, withViewer]);
    expect(sorted.map((c) => c.id)).toEqual(['with', 'without']);
  });

  it('sorts by viewer recency when both have viewer activity', () => {
    const older = mkCase('older', '2026-05-10T00:00:00Z', null, null);
    const newer = mkCase('newer', '2026-05-22T00:00:00Z', null, null);
    const sorted = sortCasesByViewerRecency([older, newer]);
    expect(sorted.map((c) => c.id)).toEqual(['newer', 'older']);
  });

  it('falls back to viewer-division recency when viewer activity ties (both null)', () => {
    const divOlder = mkCase('divOlder', null, '2026-05-10T00:00:00Z', null);
    const divNewer = mkCase('divNewer', null, '2026-05-22T00:00:00Z', null);
    const sorted = sortCasesByViewerRecency([divOlder, divNewer]);
    expect(sorted.map((c) => c.id)).toEqual(['divNewer', 'divOlder']);
  });

  it('falls back to overall recency when viewer + division both tie', () => {
    const allOlder = mkCase('allOlder', null, null, '2026-05-10T00:00:00Z');
    const allNewer = mkCase('allNewer', null, null, '2026-05-22T00:00:00Z');
    const sorted = sortCasesByViewerRecency([allOlder, allNewer]);
    expect(sorted.map((c) => c.id)).toEqual(['allNewer', 'allOlder']);
  });

  it('combines tiers correctly: viewer beats higher division beats higher overall', () => {
    const onlyOverallNewest = mkCase(
      'onlyOverall',
      null,
      null,
      '2026-05-22T00:00:00Z',
    );
    const onlyDivisionMid = mkCase(
      'onlyDiv',
      null,
      '2026-05-15T00:00:00Z',
      '2026-05-15T00:00:00Z',
    );
    const viewerOldest = mkCase(
      'viewerOldest',
      '2026-05-01T00:00:00Z',
      '2026-05-01T00:00:00Z',
      '2026-05-01T00:00:00Z',
    );
    const sorted = sortCasesByViewerRecency([
      onlyOverallNewest,
      onlyDivisionMid,
      viewerOldest,
    ]);
    expect(sorted.map((c) => c.id)).toEqual([
      'viewerOldest', // wins on tier 1 even though absolute date is oldest
      'onlyDiv', // wins on tier 2 over onlyOverall
      'onlyOverall',
    ]);
  });

  it('puts a case with no activity at all at the bottom', () => {
    const empty = mkCase('empty', null, null, null);
    const withSomething = mkCase('withSomething', null, null, '2026-05-22T00:00:00Z');
    const sorted = sortCasesByViewerRecency([empty, withSomething]);
    expect(sorted.map((c) => c.id)).toEqual(['withSomething', 'empty']);
  });

  it('is pure — does not mutate the input array', () => {
    const a = mkCase('a', '2026-05-10T00:00:00Z', null, null);
    const b = mkCase('b', '2026-05-22T00:00:00Z', null, null);
    const input = [a, b];
    const inputCopy = [...input];
    sortCasesByViewerRecency(input);
    expect(input).toEqual(inputCopy);
  });
});

describe('isViewerActiveCase', () => {
  it('is true when the case has viewer activity', () => {
    expect(
      isViewerActiveCase({
        viewerLastActivityAt: '2026-05-22T00:00:00Z',
        viewerDivisionLastActivityAt: null,
        lastActivityAt: null,
      }),
    ).toBe(true);
  });

  it('is false when the case has no viewer activity, even with division activity', () => {
    expect(
      isViewerActiveCase({
        viewerLastActivityAt: null,
        viewerDivisionLastActivityAt: '2026-05-22T00:00:00Z',
        lastActivityAt: '2026-05-22T00:00:00Z',
      }),
    ).toBe(false);
  });

  it('is false when the case has no activity at all', () => {
    expect(
      isViewerActiveCase({
        viewerLastActivityAt: null,
        viewerDivisionLastActivityAt: null,
        lastActivityAt: null,
      }),
    ).toBe(false);
  });
});
