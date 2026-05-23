import { describe, expect, it } from 'vitest';

import {
  generateNudgeCandidates,
  type NudgeGeneratorInput,
} from '@/services/copilot/nudge-generator';
import type { ObservedPatternsJson } from '@/services/copilot/state-builder';

/**
 * Sprint 0.18 — exhaustive unit tests for the PURE nudge generator.
 *
 * Coverage (20+ cases per spec):
 *   - Each of the six pattern kinds maps to exactly one candidate
 *     with the right priority, affordance slug, and eligible surfaces.
 *   - Snapshot hash is stable for identical input (idempotency).
 *   - Snapshot hash CHANGES on escalation (decision 3a) for the
 *     three escalation-bearing kinds (RECERT, MEASURE_TREND, WRITEBACK,
 *     GOAL_STALLED).
 *   - Empty observedPatterns + zero failures → zero candidates.
 *   - Mixed patterns + direct write-back failures → all candidates
 *     deduplicated against pattern-derived rows.
 *   - Affordance slug is the categorical record per kind (decision 7).
 *   - Defensive — unknown pattern kinds are skipped, not thrown.
 *   - The label string is preserved from the pattern's `label` field
 *     so the state-builder remains the source of voice copy.
 */

function baseInput(
  patterns: ObservedPatternsJson['patterns'] = [],
  failures: NudgeGeneratorInput['pendingPermanentWritebackFailures'] = [],
): NudgeGeneratorInput {
  return {
    orgId: 'org_1',
    patientId: 'pat_1',
    clinicianOrgUserId: 'ou_1',
    observedPatterns: { patterns },
    pendingPermanentWritebackFailures: failures,
  };
}

// =============================================================================
// Empty + defensive.
// =============================================================================

describe('generateNudgeCandidates — empty + defensive', () => {
  it('returns zero candidates for fully empty input', () => {
    expect(generateNudgeCandidates(baseInput())).toEqual([]);
  });

  it('skips unknown pattern kinds without throwing', () => {
    const out = generateNudgeCandidates(
      baseInput([
        // Cast through `as never` because the static enum doesn't
        // include this kind — we're testing the runtime defensive
        // branch in the generator (a future state-builder version
        // may ship a kind ahead of this generator).
        {
          kind: 'future_pattern_kind' as never,
          label: 'unknown',
          detail: {},
          observedInNoteIds: [],
          count: 1,
          firstSeen: '2026-05-22T00:00:00Z',
          lastSeen: '2026-05-22T00:00:00Z',
        },
      ]),
    );
    expect(out).toEqual([]);
  });

  it('does not throw on patterns missing required detail fields', () => {
    expect(() =>
      generateNudgeCandidates(
        baseInput([
          {
            kind: 'recert_due_soon',
            label: 'recert',
            detail: {}, // no episodeId/dueAt
            observedInNoteIds: [],
            count: 1,
            firstSeen: '2026-05-22T00:00:00Z',
            lastSeen: '2026-05-22T00:00:00Z',
          },
        ]),
      ),
    ).not.toThrow();
  });
});

// =============================================================================
// RECERT_DUE_SOON.
// =============================================================================

describe('generateNudgeCandidates — RECERT_DUE_SOON', () => {
  const pattern = {
    kind: 'recert_due_soon' as const,
    label: 'Recert due in 14 days',
    detail: {
      episodeId: 'ep_1',
      diagnosis: 'L knee OA',
      division: 'REHAB',
      dueAt: '2026-06-05T00:00:00Z',
      daysUntilDue: 14,
    },
    observedInNoteIds: [],
    count: 1,
    firstSeen: '2026-05-22T00:00:00Z',
    lastSeen: '2026-05-22T00:00:00Z',
  };

  it('emits a HIGH-priority candidate with the start-recert-visit affordance', () => {
    const out = generateNudgeCandidates(baseInput([pattern]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'RECERT_DUE_SOON',
      priority: 'HIGH',
      eligibleSurfaces: 'BOTH',
      affordanceSlug: 'start-recert-visit',
      label: 'Recert due in 14 days',
    });
    expect(out[0]?.subtitle).toBe('Due in 14 days');
  });

  it('snapshot hash is stable for identical input', () => {
    const a = generateNudgeCandidates(baseInput([pattern]))[0]!;
    const b = generateNudgeCandidates(baseInput([pattern]))[0]!;
    expect(a.sourcePatternSnapshotHash).toBe(b.sourcePatternSnapshotHash);
  });

  it('snapshot hash changes when daysUntilDue crosses a 7-day bucket (decision 3a)', () => {
    const a = generateNudgeCandidates(baseInput([pattern]))[0]!;
    const escalated = generateNudgeCandidates(
      baseInput([{ ...pattern, detail: { ...pattern.detail, daysUntilDue: 3 } }]),
    )[0]!;
    expect(a.sourcePatternSnapshotHash).not.toBe(escalated.sourcePatternSnapshotHash);
  });

  it('snapshot hash is stable within the same 7-day bucket', () => {
    const a = generateNudgeCandidates(
      baseInput([{ ...pattern, detail: { ...pattern.detail, daysUntilDue: 14 } }]),
    )[0]!;
    const sameBucket = generateNudgeCandidates(
      baseInput([{ ...pattern, detail: { ...pattern.detail, daysUntilDue: 13 } }]),
    )[0]!;
    expect(a.sourcePatternSnapshotHash).toBe(sameBucket.sourcePatternSnapshotHash);
  });
});

// =============================================================================
// CASE_FHIR_STATUS_DRIFT.
// =============================================================================

describe('generateNudgeCandidates — CASE_FHIR_STATUS_DRIFT', () => {
  const pattern = {
    kind: 'case_fhir_status_drift' as const,
    label: 'EHR drift on case (status)',
    detail: {
      driftLogId: 'drift_1',
      caseManagementId: 'case_1',
      fhirConditionId: 'cond_1',
      driftKind: 'STATUS' as const,
      detectedAt: '2026-05-22T00:00:00Z',
    },
    observedInNoteIds: [],
    count: 1,
    firstSeen: '2026-05-22T00:00:00Z',
    lastSeen: '2026-05-22T00:00:00Z',
  };

  it('emits a HIGH-priority candidate with the open-reconcile-flow affordance', () => {
    const [cand] = generateNudgeCandidates(baseInput([pattern]));
    expect(cand).toMatchObject({
      kind: 'CASE_FHIR_STATUS_DRIFT',
      priority: 'HIGH',
      affordanceSlug: 'open-reconcile-flow',
      eligibleSurfaces: 'BOTH',
    });
    expect(cand?.subtitle).toBe('Status differs from EHR');
  });

  it('subtitle distinguishes ICD vs STATUS drift', () => {
    const [icd] = generateNudgeCandidates(
      baseInput([
        { ...pattern, detail: { ...pattern.detail, driftKind: 'ICD' as const } },
      ]),
    );
    expect(icd?.subtitle).toBe('ICD code differs from EHR');
  });

  it('hash is keyed on driftLogId (idempotent across runs)', () => {
    const a = generateNudgeCandidates(baseInput([pattern]))[0]!;
    const b = generateNudgeCandidates(baseInput([pattern]))[0]!;
    expect(a.sourcePatternSnapshotHash).toBe(b.sourcePatternSnapshotHash);
  });
});

// =============================================================================
// FHIR_WRITEBACK_FAILED_PERMANENT — pattern path AND direct-failure path.
// =============================================================================

describe('generateNudgeCandidates — FHIR_WRITEBACK_FAILED_PERMANENT', () => {
  const pattern = {
    kind: 'fhir_writeback_failed_permanent' as const,
    label: 'EHR write blocked — needs review',
    detail: {
      proposalId: 'wbp_1',
      caseManagementId: 'case_1',
      failureKind: 'PERMANENT' as const,
      failureCount: 1,
      failedAt: '2026-05-22T00:00:00Z',
    },
    observedInNoteIds: [],
    count: 1,
    firstSeen: '2026-05-22T00:00:00Z',
    lastSeen: '2026-05-22T00:00:00Z',
  };

  it('emits a HIGH-priority candidate with review-failed-writeback affordance', () => {
    const [cand] = generateNudgeCandidates(baseInput([pattern]));
    expect(cand).toMatchObject({
      kind: 'FHIR_WRITEBACK_FAILED_PERMANENT',
      priority: 'HIGH',
      affordanceSlug: 'review-failed-writeback',
    });
  });

  it('hash changes when failureCount escalates (decision 3a — retry budget)', () => {
    const first = generateNudgeCandidates(baseInput([pattern]))[0]!;
    const retried = generateNudgeCandidates(
      baseInput([{ ...pattern, detail: { ...pattern.detail, failureCount: 2 } }]),
    )[0]!;
    expect(first.sourcePatternSnapshotHash).not.toBe(retried.sourcePatternSnapshotHash);
  });

  it('subtitle copy distinguishes PERMANENT vs CONFLICT', () => {
    const [perm] = generateNudgeCandidates(baseInput([pattern]));
    expect(perm?.subtitle).toMatch(/Permanent error/);
    const [conflict] = generateNudgeCandidates(
      baseInput([
        { ...pattern, detail: { ...pattern.detail, failureKind: 'CONFLICT' as const } },
      ]),
    );
    expect(conflict?.subtitle).toMatch(/EHR moved/);
  });

  it('skips when failureKind is TRANSIENT (decision: only non-transient promote)', () => {
    const out = generateNudgeCandidates(
      baseInput([
        {
          ...pattern,
          detail: { ...pattern.detail, failureKind: 'TRANSIENT' as unknown as 'PERMANENT' },
        },
      ]),
    );
    expect(out).toEqual([]);
  });

  it('direct-failure-input path generates a candidate even without a pattern', () => {
    const out = generateNudgeCandidates(
      baseInput([], [
        {
          proposalId: 'wbp_z',
          caseManagementId: 'case_z',
          failedAt: '2026-05-22T00:00:00Z',
          failureKind: 'PERMANENT',
          failureCount: 1,
        },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('FHIR_WRITEBACK_FAILED_PERMANENT');
  });

  it('dedups direct-failure-input against pattern-derived candidate (same proposal+count)', () => {
    const out = generateNudgeCandidates(
      baseInput(
        [pattern],
        [
          {
            proposalId: 'wbp_1',
            caseManagementId: 'case_1',
            failedAt: '2026-05-22T00:00:00Z',
            failureKind: 'PERMANENT',
            failureCount: 1,
          },
        ],
      ),
    );
    expect(out).toHaveLength(1);
  });
});

// =============================================================================
// MEASURE_TREND.
// =============================================================================

describe('generateNudgeCandidates — MEASURE_TREND', () => {
  const pattern = {
    kind: 'measure_trend' as const,
    label: 'PHQ-9 trending up',
    detail: {
      measureName: 'PHQ-9',
      direction: 'up' as const,
      latestValue: 19,
      latestNoteId: 'note_1',
      valuesWindow: [12, 17, 19],
    },
    observedInNoteIds: ['note_1'],
    count: 3,
    firstSeen: '2026-04-22T00:00:00Z',
    lastSeen: '2026-05-22T00:00:00Z',
  };

  it('emits a MEDIUM-priority candidate with open-plan-editor affordance', () => {
    const [cand] = generateNudgeCandidates(baseInput([pattern]));
    expect(cand).toMatchObject({
      kind: 'MEASURE_TREND',
      priority: 'MEDIUM',
      affordanceSlug: 'open-plan-editor',
    });
    expect(cand?.subtitle).toBe('12 → 17 → 19');
  });

  it('hash changes when the latest measure value changes (escalation)', () => {
    const a = generateNudgeCandidates(baseInput([pattern]))[0]!;
    const escalated = generateNudgeCandidates(
      baseInput([
        { ...pattern, detail: { ...pattern.detail, latestValue: 22 } },
      ]),
    )[0]!;
    expect(a.sourcePatternSnapshotHash).not.toBe(escalated.sourcePatternSnapshotHash);
  });
});

// =============================================================================
// GOAL_STALLED.
// =============================================================================

describe('generateNudgeCandidates — GOAL_STALLED', () => {
  const pattern = {
    kind: 'goal_stalled' as const,
    label: 'Goal stalled: post-op ROM',
    detail: {
      goalId: 'goal_1',
      goalText: 'Post-op ROM to 120°',
      lastProgressAt: '2026-04-22T00:00:00Z',
      daysSinceLastProgress: 30,
    },
    observedInNoteIds: [],
    observedInGoalIds: ['goal_1'],
    count: 1,
    firstSeen: '2026-04-22T00:00:00Z',
    lastSeen: '2026-05-22T00:00:00Z',
  };

  it('emits a MEDIUM-priority candidate with reevaluate-goal affordance', () => {
    const [cand] = generateNudgeCandidates(baseInput([pattern]));
    expect(cand).toMatchObject({
      kind: 'GOAL_STALLED',
      priority: 'MEDIUM',
      affordanceSlug: 'reevaluate-goal',
      eligibleSurfaces: 'VISIT_PREPARE',
    });
    expect(cand?.subtitle).toBe('No progress in 30 days');
  });

  it('hash stable within the 7-day bucket', () => {
    const a = generateNudgeCandidates(baseInput([pattern]))[0]!;
    const b = generateNudgeCandidates(
      baseInput([
        { ...pattern, detail: { ...pattern.detail, daysSinceLastProgress: 32 } },
      ]),
    )[0]!;
    expect(a.sourcePatternSnapshotHash).toBe(b.sourcePatternSnapshotHash);
  });

  it('hash changes across 7-day buckets (escalation)', () => {
    const a = generateNudgeCandidates(baseInput([pattern]))[0]!;
    const escalated = generateNudgeCandidates(
      baseInput([
        { ...pattern, detail: { ...pattern.detail, daysSinceLastProgress: 90 } },
      ]),
    )[0]!;
    expect(a.sourcePatternSnapshotHash).not.toBe(escalated.sourcePatternSnapshotHash);
  });
});

// =============================================================================
// TOPIC_MENTIONED_UNADDRESSED.
// =============================================================================

describe('generateNudgeCandidates — TOPIC_MENTIONED_UNADDRESSED', () => {
  const pattern = {
    kind: 'topic_mentioned_unaddressed' as const,
    label: 'Sleep mentioned in last 3 visits',
    detail: {
      topic: 'Sleep',
      lastSeenAt: '2026-05-22T00:00:00Z',
      occurrenceCount: 3,
    },
    observedInNoteIds: ['note_1', 'note_2', 'note_3'],
    count: 3,
    firstSeen: '2026-03-01T00:00:00Z',
    lastSeen: '2026-05-22T00:00:00Z',
  };

  it('emits a LOW-priority candidate with open-plan-editor affordance', () => {
    const [cand] = generateNudgeCandidates(baseInput([pattern]));
    expect(cand).toMatchObject({
      kind: 'TOPIC_MENTIONED_UNADDRESSED',
      priority: 'LOW',
      affordanceSlug: 'open-plan-editor',
      eligibleSurfaces: 'VISIT_PREPARE',
    });
  });

  it('hash is case-insensitive on topic', () => {
    const a = generateNudgeCandidates(baseInput([pattern]))[0]!;
    const sameTopicDifferentCase = generateNudgeCandidates(
      baseInput([{ ...pattern, detail: { ...pattern.detail, topic: 'sleep' } }]),
    )[0]!;
    expect(a.sourcePatternSnapshotHash).toBe(sameTopicDifferentCase.sourcePatternSnapshotHash);
  });
});

// =============================================================================
// Mixed + ordering.
// =============================================================================

describe('generateNudgeCandidates — mixed', () => {
  it('emits one candidate per pattern across all kinds', () => {
    const out = generateNudgeCandidates(
      baseInput([
        {
          kind: 'recert_due_soon',
          label: 'Recert due',
          detail: { episodeId: 'ep_1', dueAt: '2026-06-01', daysUntilDue: 5 },
          observedInNoteIds: [],
          count: 1,
          firstSeen: '2026-05-22T00:00:00Z',
          lastSeen: '2026-05-22T00:00:00Z',
        },
        {
          kind: 'measure_trend',
          label: 'PHQ-9 up',
          detail: { measureName: 'PHQ-9', latestNoteId: 'n_1', latestValue: 19 },
          observedInNoteIds: ['n_1'],
          count: 1,
          firstSeen: '2026-05-22T00:00:00Z',
          lastSeen: '2026-05-22T00:00:00Z',
        },
        {
          kind: 'goal_stalled',
          label: 'Goal stalled',
          detail: { goalId: 'g_1', daysSinceLastProgress: 30 },
          observedInNoteIds: [],
          count: 1,
          firstSeen: '2026-05-22T00:00:00Z',
          lastSeen: '2026-05-22T00:00:00Z',
        },
      ]),
    );
    expect(out).toHaveLength(3);
    expect(new Set(out.map((c) => c.kind))).toEqual(
      new Set(['RECERT_DUE_SOON', 'MEASURE_TREND', 'GOAL_STALLED']),
    );
  });

  it('candidate label is taken verbatim from pattern.label (state-builder voice copy preserved)', () => {
    const out = generateNudgeCandidates(
      baseInput([
        {
          kind: 'recert_due_soon',
          label: 'Recert is overdue — please review',
          detail: { episodeId: 'ep_1', dueAt: '2026-06-01', daysUntilDue: 5 },
          observedInNoteIds: [],
          count: 1,
          firstSeen: '2026-05-22T00:00:00Z',
          lastSeen: '2026-05-22T00:00:00Z',
        },
      ]),
    );
    expect(out[0]?.label).toBe('Recert is overdue — please review');
  });

  it('snapshot json carries the source detail (clinical surface only)', () => {
    const [cand] = generateNudgeCandidates(
      baseInput([
        {
          kind: 'measure_trend',
          label: 'PHQ-9 up',
          detail: {
            measureName: 'PHQ-9',
            latestNoteId: 'n_1',
            latestValue: 19,
            valuesWindow: [12, 17, 19],
          },
          observedInNoteIds: ['n_1'],
          count: 1,
          firstSeen: '2026-05-22T00:00:00Z',
          lastSeen: '2026-05-22T00:00:00Z',
        },
      ]),
    );
    expect(cand?.sourcePatternSnapshotJson).toMatchObject({
      measureName: 'PHQ-9',
      latestValue: 19,
      valuesWindow: [12, 17, 19],
    });
  });
});
