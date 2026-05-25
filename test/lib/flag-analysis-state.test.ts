import { describe, it, expect } from 'vitest';

import {
  STALE_PENDING_MS,
  deriveFlagAnalysisState,
  isFlagAnalysisPending,
} from '@/lib/notes/flag-analysis-state';

/**
 * Regression coverage for the flag-analysis lifecycle helper.
 *
 * Background
 * ----------
 * The sign route, /flags GET, and review-screen polling all derive
 * analyzer state from the same two timestamps on Note. The lifecycle
 * gate is the only thing standing between a clinician and a sign that
 * pre-empts an in-flight analysis (which produced flags surfacing AFTER
 * sign — a rule-3 violation). Edge cases the tests below pin down:
 *
 *   - Stale pending guard: a worker that crashes mid-run can't block
 *     sign forever; the helper downgrades to 'completed' after
 *     STALE_PENDING_MS.
 *   - Equal timestamps: completedAt === startedAt is the boundary
 *     between pending and completed and must resolve to 'completed'.
 *   - Re-runs: a fresh startedAt that surpasses an old completedAt
 *     reverts to 'pending' (older completion shouldn't satisfy a
 *     newer run).
 */
describe('deriveFlagAnalysisState', () => {
  const now = new Date('2026-05-25T15:00:00.000Z');

  it("'idle' when neither timestamp is set (never analyzed)", () => {
    expect(
      deriveFlagAnalysisState(
        { flagAnalysisStartedAt: null, flagAnalysisCompletedAt: null },
        now,
      ),
    ).toBe('idle');
  });

  it("'pending' when started is set but completed is null", () => {
    const startedAt = new Date(now.getTime() - 30 * 1000);
    expect(
      deriveFlagAnalysisState(
        { flagAnalysisStartedAt: startedAt, flagAnalysisCompletedAt: null },
        now,
      ),
    ).toBe('pending');
  });

  it("'pending' when an OLDER completion predates a newer started (re-run race)", () => {
    const startedAt = new Date(now.getTime() - 10 * 1000);
    const completedAt = new Date(now.getTime() - 60 * 1000); // older than started
    expect(
      deriveFlagAnalysisState(
        {
          flagAnalysisStartedAt: startedAt,
          flagAnalysisCompletedAt: completedAt,
        },
        now,
      ),
    ).toBe('pending');
  });

  it("'completed' when completedAt === startedAt (boundary)", () => {
    const ts = new Date(now.getTime() - 5 * 1000);
    expect(
      deriveFlagAnalysisState(
        { flagAnalysisStartedAt: ts, flagAnalysisCompletedAt: ts },
        now,
      ),
    ).toBe('completed');
  });

  it("'completed' when completedAt is after startedAt (happy path)", () => {
    const startedAt = new Date(now.getTime() - 30 * 1000);
    const completedAt = new Date(now.getTime() - 10 * 1000);
    expect(
      deriveFlagAnalysisState(
        {
          flagAnalysisStartedAt: startedAt,
          flagAnalysisCompletedAt: completedAt,
        },
        now,
      ),
    ).toBe('completed');
  });

  it("'completed' for stale pending — worker died, do not block sign forever", () => {
    // Started older than the stale window with no completion. The helper
    // downgrades to 'completed' so a dead worker can't strand a clinician.
    const startedAt = new Date(now.getTime() - STALE_PENDING_MS - 1);
    expect(
      deriveFlagAnalysisState(
        { flagAnalysisStartedAt: startedAt, flagAnalysisCompletedAt: null },
        now,
      ),
    ).toBe('completed');
  });

  it("'pending' for an in-flight analysis just under the stale window", () => {
    const startedAt = new Date(now.getTime() - STALE_PENDING_MS + 1);
    expect(
      deriveFlagAnalysisState(
        { flagAnalysisStartedAt: startedAt, flagAnalysisCompletedAt: null },
        now,
      ),
    ).toBe('pending');
  });
});

describe('isFlagAnalysisPending', () => {
  const now = new Date('2026-05-25T15:00:00.000Z');

  it('returns true only for the pending state', () => {
    expect(
      isFlagAnalysisPending(
        {
          flagAnalysisStartedAt: new Date(now.getTime() - 5_000),
          flagAnalysisCompletedAt: null,
        },
        now,
      ),
    ).toBe(true);
    expect(
      isFlagAnalysisPending(
        { flagAnalysisStartedAt: null, flagAnalysisCompletedAt: null },
        now,
      ),
    ).toBe(false);
    expect(
      isFlagAnalysisPending(
        {
          flagAnalysisStartedAt: new Date(now.getTime() - 30_000),
          flagAnalysisCompletedAt: new Date(now.getTime() - 10_000),
        },
        now,
      ),
    ).toBe(false);
  });
});
