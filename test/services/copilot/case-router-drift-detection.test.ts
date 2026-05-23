import { describe, expect, it } from 'vitest';

import {
  detectDriftSignals,
  type DriftDetectorCase,
  type DriftSignal,
  type FhirConditionForRouter,
  type FhirConditionClinicalStatus,
} from '@/services/copilot/case-router-fhir';

/**
 * Sprint 0.16 — exhaustive unit tests for the PURE `detectDriftSignals`
 * function. Covers the full detection-rules table from the spec, the
 * ICD-drift rule, and the corner cases (no mirror, missing condition,
 * non-routing case statuses).
 *
 * The test data is structured so each describe block targets one row of
 * the spec's decision table; failures call out exactly which row regressed.
 */

const ACTIVE_STATUSES: FhirConditionClinicalStatus[] = [
  'active',
  'recurrence',
  'relapse',
];
const RESOLVED_STATUSES: FhirConditionClinicalStatus[] = [
  'resolved',
  'remission',
];
const ALL_STATUSES: FhirConditionClinicalStatus[] = [
  ...ACTIVE_STATUSES,
  ...RESOLVED_STATUSES,
];

function makeCase(overrides: Partial<DriftDetectorCase> = {}): DriftDetectorCase {
  return {
    id: 'case_1',
    status: 'ACTIVE',
    primaryIcd: 'M17.11',
    primaryIcdLabel: 'Right knee OA',
    mirrorsFhirConditionId: 'cond_knee',
    ...overrides,
  };
}

function makeCondition(
  overrides: Partial<FhirConditionForRouter> = {},
): FhirConditionForRouter {
  return {
    fhirId: 'cond_knee',
    icd: 'M17.11',
    icdLabel: 'Right knee OA',
    clinicalStatus: 'active',
    recordedDate: '2024-08-15',
    recorderName: 'Dr. Patel',
    lastUpdated: '2024-08-15T10:00:00Z',
    ...overrides,
  };
}

// =============================================================================
// Decision table — exhaustive coverage row by row.
// =============================================================================

describe('detectDriftSignals — decision table', () => {
  describe('ACTIVE × clinically-active → NO drift', () => {
    for (const status of ACTIVE_STATUSES) {
      it(`ACTIVE × ${status} → []`, () => {
        const signals = detectDriftSignals(
          [makeCase({ status: 'ACTIVE' })],
          [makeCondition({ clinicalStatus: status })],
        );
        expect(signals.filter((s) => s.kind === 'STATUS')).toEqual([]);
      });
    }
  });

  describe('ACTIVE × resolved/remission → STATUS drift', () => {
    for (const status of RESOLVED_STATUSES) {
      it(`ACTIVE × ${status} → 1 STATUS signal`, () => {
        const signals = detectDriftSignals(
          [makeCase({ status: 'ACTIVE' })],
          [makeCondition({ clinicalStatus: status })],
        );
        const statusSignals = signals.filter((s) => s.kind === 'STATUS');
        expect(statusSignals).toHaveLength(1);
        expect(statusSignals[0]).toMatchObject<Partial<DriftSignal>>({
          kind: 'STATUS',
          caseManagementId: 'case_1',
          fhirConditionId: 'cond_knee',
          caseStatus: 'ACTIVE',
          conditionStatus: status,
        });
      });
    }
  });

  describe('CLOSED × clinically-active → STATUS drift', () => {
    for (const status of ACTIVE_STATUSES) {
      it(`CLOSED × ${status} → 1 STATUS signal`, () => {
        const signals = detectDriftSignals(
          [makeCase({ status: 'CLOSED' })],
          [makeCondition({ clinicalStatus: status })],
        );
        const statusSignals = signals.filter((s) => s.kind === 'STATUS');
        expect(statusSignals).toHaveLength(1);
        expect(statusSignals[0]).toMatchObject<Partial<DriftSignal>>({
          kind: 'STATUS',
          caseStatus: 'CLOSED',
          conditionStatus: status,
        });
      });
    }
  });

  describe('CLOSED × resolved/remission → NO drift', () => {
    for (const status of RESOLVED_STATUSES) {
      it(`CLOSED × ${status} → []`, () => {
        const signals = detectDriftSignals(
          [makeCase({ status: 'CLOSED' })],
          [makeCondition({ clinicalStatus: status })],
        );
        expect(signals.filter((s) => s.kind === 'STATUS')).toEqual([]);
      });
    }
  });

  describe('CANCELLED × (any) → NO drift (not clinician-managed)', () => {
    for (const status of ALL_STATUSES) {
      it(`CANCELLED × ${status} → []`, () => {
        const signals = detectDriftSignals(
          [makeCase({ status: 'CANCELLED' })],
          [makeCondition({ clinicalStatus: status })],
        );
        expect(signals).toEqual([]);
      });
    }
  });

  describe('PENDING_ROUTER × (any) → NO drift (out of scope)', () => {
    for (const status of ALL_STATUSES) {
      it(`PENDING_ROUTER × ${status} → []`, () => {
        const signals = detectDriftSignals(
          [makeCase({ status: 'PENDING_ROUTER' })],
          [makeCondition({ clinicalStatus: status })],
        );
        expect(signals).toEqual([]);
      });
    }
  });
});

// =============================================================================
// ICD-drift rule (independent of status drift).
// =============================================================================

describe('detectDriftSignals — ICD drift rule', () => {
  it('fires when both ICDs are coded but differ', () => {
    const signals = detectDriftSignals(
      [
        makeCase({
          primaryIcd: 'M17.11',
          primaryIcdLabel: 'Right knee OA (per OmniScribe)',
        }),
      ],
      [
        makeCondition({
          icd: 'M17.12',
          icdLabel: 'Left knee OA (per EHR)',
        }),
      ],
    );
    const icdSignals = signals.filter((s) => s.kind === 'ICD');
    expect(icdSignals).toHaveLength(1);
    expect(icdSignals[0]).toMatchObject<Partial<DriftSignal>>({
      kind: 'ICD',
      caseIcd: 'M17.11',
      caseIcdLabel: 'Right knee OA (per OmniScribe)',
      conditionIcd: 'M17.12',
      conditionIcdLabel: 'Left knee OA (per EHR)',
    });
  });

  it('does NOT fire when ICDs match exactly', () => {
    const signals = detectDriftSignals(
      [makeCase({ primaryIcd: 'M17.11' })],
      [makeCondition({ icd: 'M17.11' })],
    );
    expect(signals.filter((s) => s.kind === 'ICD')).toEqual([]);
  });

  it('does NOT fire when case primaryIcd is null ("Needs coding" — not drift)', () => {
    const signals = detectDriftSignals(
      [makeCase({ primaryIcd: null })],
      [makeCondition({ icd: 'M17.11' })],
    );
    expect(signals.filter((s) => s.kind === 'ICD')).toEqual([]);
  });

  it('fires alongside STATUS drift when both apply', () => {
    const signals = detectDriftSignals(
      [
        makeCase({
          status: 'ACTIVE',
          primaryIcd: 'M17.11',
          primaryIcdLabel: 'Right knee OA',
        }),
      ],
      [
        makeCondition({
          clinicalStatus: 'resolved',
          icd: 'M17.12',
          icdLabel: 'Left knee OA',
        }),
      ],
    );
    // Both kinds expected — one row per drift kind in CaseFhirDriftLog.
    expect(signals.map((s) => s.kind).sort()).toEqual(['ICD', 'STATUS']);
  });
});

// =============================================================================
// Mirror lookup + corner cases.
// =============================================================================

describe('detectDriftSignals — corner cases', () => {
  it('skips cases without a mirrored Condition (mirrorsFhirConditionId === null)', () => {
    const signals = detectDriftSignals(
      [
        makeCase({
          mirrorsFhirConditionId: null,
          status: 'ACTIVE',
        }),
      ],
      [makeCondition({ clinicalStatus: 'resolved' })],
    );
    expect(signals).toEqual([]);
  });

  it('skips mirrored cases when the matching Condition is not in the supplied list', () => {
    const signals = detectDriftSignals(
      [
        makeCase({
          status: 'ACTIVE',
          mirrorsFhirConditionId: 'cond_missing_from_cache',
        }),
      ],
      [makeCondition({ fhirId: 'some_other_id' })],
    );
    expect(signals).toEqual([]);
  });

  it('detects drift across multiple cases independently', () => {
    const signals = detectDriftSignals(
      [
        makeCase({
          id: 'case_active_resolved',
          status: 'ACTIVE',
          mirrorsFhirConditionId: 'cond_a',
        }),
        makeCase({
          id: 'case_closed_active',
          status: 'CLOSED',
          mirrorsFhirConditionId: 'cond_b',
        }),
        makeCase({
          id: 'case_consistent',
          status: 'ACTIVE',
          mirrorsFhirConditionId: 'cond_c',
        }),
      ],
      [
        makeCondition({ fhirId: 'cond_a', clinicalStatus: 'resolved' }),
        makeCondition({ fhirId: 'cond_b', clinicalStatus: 'active' }),
        makeCondition({ fhirId: 'cond_c', clinicalStatus: 'active' }),
      ],
    );
    const statusByCase = signals
      .filter((s) => s.kind === 'STATUS')
      .map((s) => s.caseManagementId)
      .sort();
    expect(statusByCase).toEqual(['case_active_resolved', 'case_closed_active']);
  });

  it('is idempotent — same inputs produce identical outputs', () => {
    const cases = [
      makeCase({ status: 'ACTIVE', mirrorsFhirConditionId: 'cond_knee' }),
    ];
    const conditions = [makeCondition({ clinicalStatus: 'resolved' })];
    expect(detectDriftSignals(cases, conditions)).toEqual(
      detectDriftSignals(cases, conditions),
    );
  });

  it('returns [] when there are no mirrored cases at all', () => {
    expect(detectDriftSignals([], [makeCondition()])).toEqual([]);
  });

  it('returns [] when there are no Conditions at all', () => {
    expect(detectDriftSignals([makeCase()], [])).toEqual([]);
  });

  it('signal carries through the FHIR recorder + recordedDate provenance', () => {
    const signals = detectDriftSignals(
      [makeCase({ status: 'ACTIVE' })],
      [
        makeCondition({
          clinicalStatus: 'resolved',
          recordedDate: '2025-01-12',
          recorderName: 'Dr. Park',
        }),
      ],
    );
    const statusSignal = signals.find((s) => s.kind === 'STATUS');
    expect(statusSignal?.recordedDate).toBe('2025-01-12');
    expect(statusSignal?.recorderName).toBe('Dr. Park');
  });
});
