import { describe, expect, it } from 'vitest';

import {
  buildCreateConditionPayload,
  buildPatchOperations,
  proposeWriteBack,
  isWriteBackIdempotencyKey,
  mapCaseStatusToFhirClinicalStatus,
  FHIR_CLINICAL_STATUS_SYSTEM,
  ICD_10_CM_SYSTEM,
  OMNISCRIBE_ORIGIN_EXTENSION_URL,
  WriteBackInputError,
  type BuildPayloadInput,
  type CaseWriteBackTrigger,
} from '@/services/fhir/case-writeback';

/**
 * Sprint 0.17 — exhaustive unit tests for the PURE case-writeback
 * service. Coverage per the spec's "20+ cases":
 *
 *   - CREATE for open-new + open-new-from-condition with ICD + ACTIVE
 *     → `clinicalStatus = active` + ICD coded against ICD-10-CM
 *   - CREATE includes the `omniscribe-origin` extension on the resource
 *   - CREATE rejects when `patient.fhirPatientId` is null (rule 20)
 *   - CREATE rejects when `case.primaryIcd` is null (Needs coding gate)
 *   - PATCH status flip ACTIVE→CLOSED → 1 JSON Patch op on /clinicalStatus
 *   - PATCH status flip with no change → 0 ops (no-op)
 *   - PATCH ICD update → 1 op on /code only
 *   - PATCH combined status + ICD → 2 ops in deterministic order
 *   - proposeWriteBack returns null for a no-op patch (idempotent re-run)
 *   - proposeWriteBack chooses CREATE when mirror is null
 *   - proposeWriteBack chooses PATCH when mirror is non-null
 *   - PATCH carries `ifMatchVersion` from the existing condition snapshot
 *   - idempotencyKey is a valid cuid2 + unique per call
 *   - PATCH rejects when existingCondition is null (defense in depth)
 *   - Rejects CANCELLED / PENDING_ROUTER case statuses (the gate)
 *   - All ICDs come from the OS case — no FHIR-side leakage
 */

const TRIGGER_OPEN_NEW: CaseWriteBackTrigger = {
  kind: 'open-new',
  caseRouterRunId: 'run_1',
};

const TRIGGER_OPEN_NEW_FROM_CONDITION: CaseWriteBackTrigger = {
  kind: 'open-new-from-condition',
  caseRouterRunId: 'run_2',
};

const TRIGGER_RECONCILE_CLOSE: CaseWriteBackTrigger = {
  kind: 'reconcile-with-mutation',
  caseRouterRunId: 'run_3',
  driftLogId: 'drift_1',
  resolution: 'close-case',
};

const TRIGGER_RECONCILE_UPDATE_ICD: CaseWriteBackTrigger = {
  kind: 'reconcile-with-mutation',
  caseRouterRunId: 'run_4',
  driftLogId: 'drift_2',
  resolution: 'update-case-icd',
};

function baseInput(overrides: Partial<BuildPayloadInput> = {}): BuildPayloadInput {
  return {
    case: {
      id: 'case_knee',
      primaryIcd: 'M17.11',
      primaryIcdLabel: 'Right knee OA',
      status: 'ACTIVE',
      mirrorsFhirConditionId: null,
    },
    patient: {
      id: 'pat_1',
      fhirPatientId: 'fhir-pat-1',
    },
    clinician: {
      orgUserId: 'ou_1',
      recorderRefDisplay: 'Dr. Mitchell',
    },
    existingCondition: null,
    trigger: TRIGGER_OPEN_NEW,
    now: new Date('2026-05-22T12:00:00Z'),
    ...overrides,
  };
}

// =============================================================================
// CREATE payload.
// =============================================================================

describe('buildCreateConditionPayload', () => {
  it('builds a FHIR R4 Condition resource for an ACTIVE coded case', () => {
    const payload = buildCreateConditionPayload(baseInput());
    expect(payload.resourceType).toBe('Condition');
    expect(payload.subject.reference).toBe('Patient/fhir-pat-1');
    expect(payload.code.coding[0]).toMatchObject({
      system: ICD_10_CM_SYSTEM,
      code: 'M17.11',
      display: 'Right knee OA',
    });
    expect(payload.clinicalStatus.coding[0]).toMatchObject({
      system: FHIR_CLINICAL_STATUS_SYSTEM,
      code: 'active',
    });
    expect(payload.recorder?.display).toBe('Dr. Mitchell');
    expect(payload.recordedDate).toBe('2026-05-22T12:00:00.000Z');
  });

  it('stamps the omniscribe-origin extension with the OS case id', () => {
    const payload = buildCreateConditionPayload(baseInput());
    const ext = payload.extension ?? [];
    expect(ext).toHaveLength(1);
    expect(ext[0]).toMatchObject({
      url: OMNISCRIBE_ORIGIN_EXTENSION_URL,
      valueString: 'omniscribe-case:case_knee',
    });
  });

  it('maps OS status CLOSED → FHIR clinicalStatus=resolved', () => {
    const payload = buildCreateConditionPayload(
      baseInput({ case: { ...baseInput().case, status: 'CLOSED' } }),
    );
    expect(payload.clinicalStatus.coding[0]?.code).toBe('resolved');
  });

  it('rejects when patient.fhirPatientId is missing (rule 20 defense)', () => {
    expect(() =>
      buildCreateConditionPayload(
        baseInput({ patient: { id: 'pat_1', fhirPatientId: '' } }),
      ),
    ).toThrow(WriteBackInputError);
  });

  it('rejects when case.primaryIcd is missing (Needs coding gate)', () => {
    expect(() =>
      buildCreateConditionPayload(
        baseInput({
          case: { ...baseInput().case, primaryIcd: '' },
        }),
      ),
    ).toThrow(/case_not_coded/);
  });

  it('rejects when case.status is CANCELLED or PENDING_ROUTER', () => {
    for (const status of ['CANCELLED', 'PENDING_ROUTER'] as const) {
      expect(() =>
        buildCreateConditionPayload(
          baseInput({ case: { ...baseInput().case, status } }),
        ),
      ).toThrow(/case_status_not_writable/);
    }
  });

  it('works identically for open-new and open-new-from-condition triggers', () => {
    const a = buildCreateConditionPayload(baseInput({ trigger: TRIGGER_OPEN_NEW }));
    const b = buildCreateConditionPayload(
      baseInput({ trigger: TRIGGER_OPEN_NEW_FROM_CONDITION }),
    );
    expect(a).toEqual(b);
  });

  it('uses ICD-10-CM as the coding system (OS internal coding contract)', () => {
    const payload = buildCreateConditionPayload(baseInput());
    expect(payload.code.coding[0]?.system).toBe(ICD_10_CM_SYSTEM);
  });
});

// =============================================================================
// Status mapper.
// =============================================================================

describe('mapCaseStatusToFhirClinicalStatus', () => {
  it('maps ACTIVE → active', () => {
    expect(mapCaseStatusToFhirClinicalStatus('ACTIVE')).toBe('active');
  });
  it('maps CLOSED → resolved', () => {
    expect(mapCaseStatusToFhirClinicalStatus('CLOSED')).toBe('resolved');
  });
  it('maps CANCELLED → active (defensive; gate excludes anyway)', () => {
    expect(mapCaseStatusToFhirClinicalStatus('CANCELLED')).toBe('active');
  });
  it('maps PENDING_ROUTER → active (defensive)', () => {
    expect(mapCaseStatusToFhirClinicalStatus('PENDING_ROUTER')).toBe('active');
  });
});

// =============================================================================
// PATCH ops.
// =============================================================================

describe('buildPatchOperations', () => {
  function patchInput(
    overrides: Partial<BuildPayloadInput> = {},
  ): BuildPayloadInput {
    return baseInput({
      case: {
        id: 'case_knee',
        primaryIcd: 'M17.11',
        primaryIcdLabel: 'Right knee OA',
        status: 'CLOSED',
        mirrorsFhirConditionId: 'cond_knee',
      },
      existingCondition: {
        fhirConditionId: 'cond_knee',
        versionId: '5',
        clinicalStatus: 'active',
        icd: 'M17.11',
        icdLabel: 'Right knee OA',
      },
      trigger: TRIGGER_RECONCILE_CLOSE,
      ...overrides,
    });
  }

  it('emits one /clinicalStatus op when OS closed + EHR still active', () => {
    const ops = buildPatchOperations(patchInput());
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      op: 'replace',
      path: '/clinicalStatus',
    });
    // The value carries the FHIR coding for `resolved`.
    const value = ops[0]?.value as { coding: Array<{ code: string }> };
    expect(value.coding[0]?.code).toBe('resolved');
  });

  it('returns 0 ops when OS + EHR already agree on status (no drift)', () => {
    const ops = buildPatchOperations(
      patchInput({
        case: {
          id: 'case_knee',
          primaryIcd: 'M17.11',
          primaryIcdLabel: 'Right knee OA',
          status: 'ACTIVE',
          mirrorsFhirConditionId: 'cond_knee',
        },
      }),
    );
    expect(ops).toEqual([]);
  });

  it('emits one /code op when OS ICD differs from EHR ICD', () => {
    const ops = buildPatchOperations(
      patchInput({
        case: {
          id: 'case_knee',
          primaryIcd: 'M17.12',
          primaryIcdLabel: 'Left knee OA',
          status: 'ACTIVE',
          mirrorsFhirConditionId: 'cond_knee',
        },
        existingCondition: {
          fhirConditionId: 'cond_knee',
          versionId: '5',
          clinicalStatus: 'active',
          icd: 'M17.11',
          icdLabel: 'Right knee OA',
        },
        trigger: TRIGGER_RECONCILE_UPDATE_ICD,
      }),
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]?.path).toBe('/code');
    const value = ops[0]?.value as { coding: Array<{ code: string }> };
    expect(value.coding[0]?.code).toBe('M17.12');
  });

  it('emits two ops in deterministic order when both status + ICD changed', () => {
    const ops = buildPatchOperations(
      patchInput({
        case: {
          id: 'case_knee',
          primaryIcd: 'M17.12',
          primaryIcdLabel: 'Left knee OA',
          status: 'CLOSED',
          mirrorsFhirConditionId: 'cond_knee',
        },
        existingCondition: {
          fhirConditionId: 'cond_knee',
          versionId: '5',
          clinicalStatus: 'active',
          icd: 'M17.11',
          icdLabel: 'Right knee OA',
        },
      }),
    );
    expect(ops.map((o) => o.path)).toEqual(['/clinicalStatus', '/code']);
  });

  it('does NOT fire ICD op when one side is unset ("Needs coding" territory)', () => {
    // PATCH with EHR ICD null happens only via misuse; the function
    // skips the ICD op rather than emitting a half-defined replace.
    const ops = buildPatchOperations(
      patchInput({
        case: {
          id: 'case_knee',
          primaryIcd: 'M17.11',
          primaryIcdLabel: 'Right knee OA',
          status: 'ACTIVE',
          mirrorsFhirConditionId: 'cond_knee',
        },
        existingCondition: {
          fhirConditionId: 'cond_knee',
          versionId: '5',
          clinicalStatus: 'active',
          icd: '', // simulates null/unset cached ICD
          icdLabel: '',
        },
      }),
    );
    expect(ops).toEqual([]);
  });

  it('collapses FHIR-side remission/relapse to active/resolved before diffing', () => {
    // `remission` collapses to `resolved` — OS ACTIVE vs EHR remission
    // should fire a status op flipping EHR back to active.
    const ops = buildPatchOperations(
      patchInput({
        case: {
          id: 'case_knee',
          primaryIcd: 'M17.11',
          primaryIcdLabel: 'Right knee OA',
          status: 'ACTIVE',
          mirrorsFhirConditionId: 'cond_knee',
        },
        existingCondition: {
          fhirConditionId: 'cond_knee',
          versionId: '5',
          clinicalStatus: 'remission',
          icd: 'M17.11',
          icdLabel: 'Right knee OA',
        },
      }),
    );
    expect(ops).toHaveLength(1);
    const value = ops[0]?.value as { coding: Array<{ code: string }> };
    expect(value.coding[0]?.code).toBe('active');
  });

  it('throws when existingCondition is null on a PATCH attempt (defense)', () => {
    expect(() =>
      buildPatchOperations(
        patchInput({ existingCondition: null }),
      ),
    ).toThrow(/patch_requires_existing_condition/);
  });
});

// =============================================================================
// proposeWriteBack — orchestration.
// =============================================================================

describe('proposeWriteBack', () => {
  it('returns a CREATE row when the case has no mirror', () => {
    const row = proposeWriteBack(baseInput());
    expect(row).not.toBeNull();
    expect(row!.operation).toBe('CREATE');
    expect(row!.fhirConditionId).toBeNull();
    expect(row!.ifMatchVersion).toBeNull();
    expect(row!.triggerKind).toBe('open-new');
    expect(row!.caseRouterRunId).toBe('run_1');
    expect(row!.driftLogId).toBeNull();
  });

  it('returns a PATCH row when the case mirrors a Condition + diffs exist', () => {
    const row = proposeWriteBack(
      baseInput({
        case: {
          id: 'case_knee',
          primaryIcd: 'M17.11',
          primaryIcdLabel: 'Right knee OA',
          status: 'CLOSED',
          mirrorsFhirConditionId: 'cond_knee',
        },
        existingCondition: {
          fhirConditionId: 'cond_knee',
          versionId: '5',
          clinicalStatus: 'active',
          icd: 'M17.11',
          icdLabel: 'Right knee OA',
        },
        trigger: TRIGGER_RECONCILE_CLOSE,
      }),
    );
    expect(row).not.toBeNull();
    expect(row!.operation).toBe('PATCH');
    expect(row!.fhirConditionId).toBe('cond_knee');
    expect(row!.ifMatchVersion).toBe('5');
    expect(row!.triggerKind).toBe('reconcile-with-mutation');
    expect(row!.driftLogId).toBe('drift_1');
  });

  it('returns NULL for a PATCH with no actual diffs (idempotent re-run)', () => {
    const row = proposeWriteBack(
      baseInput({
        case: {
          id: 'case_knee',
          primaryIcd: 'M17.11',
          primaryIcdLabel: 'Right knee OA',
          status: 'ACTIVE',
          mirrorsFhirConditionId: 'cond_knee',
        },
        existingCondition: {
          fhirConditionId: 'cond_knee',
          versionId: '5',
          clinicalStatus: 'active',
          icd: 'M17.11',
          icdLabel: 'Right knee OA',
        },
        trigger: TRIGGER_RECONCILE_CLOSE,
      }),
    );
    expect(row).toBeNull();
  });

  it('every idempotencyKey is a valid cuid2', () => {
    const row = proposeWriteBack(baseInput())!;
    expect(isWriteBackIdempotencyKey(row.idempotencyKey)).toBe(true);
  });

  it('generates a unique idempotencyKey per call (high-entropy)', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const row = proposeWriteBack(baseInput())!;
      keys.add(row.idempotencyKey);
    }
    expect(keys.size).toBe(100);
  });

  it('throws when patient.fhirPatientId is missing on PATCH path too', () => {
    expect(() =>
      proposeWriteBack(
        baseInput({
          case: {
            id: 'case_knee',
            primaryIcd: 'M17.11',
            primaryIcdLabel: 'Right knee OA',
            status: 'CLOSED',
            mirrorsFhirConditionId: 'cond_knee',
          },
          existingCondition: {
            fhirConditionId: 'cond_knee',
            versionId: '5',
            clinicalStatus: 'active',
            icd: 'M17.11',
            icdLabel: 'Right knee OA',
          },
          patient: { id: 'pat_1', fhirPatientId: '' },
          trigger: TRIGGER_RECONCILE_CLOSE,
        }),
      ),
    ).toThrow(/missing_fhir_patient_id/);
  });

  it('CREATE payload defends rule 20 — no ICD from FHIR-side leakage', () => {
    // Even if existingCondition is somehow set with a different ICD,
    // the CREATE path NEVER consults it. The OS case's primaryIcd is
    // the single source of truth.
    const row = proposeWriteBack(
      baseInput({
        case: {
          id: 'case_knee',
          primaryIcd: 'M17.11',
          primaryIcdLabel: 'Right knee OA',
          status: 'ACTIVE',
          mirrorsFhirConditionId: null, // CREATE path
        },
        existingCondition: {
          fhirConditionId: 'leaky_cond',
          versionId: '5',
          clinicalStatus: 'active',
          icd: 'I10',
          icdLabel: 'Hypertension',
        },
      }),
    )!;
    expect(row.operation).toBe('CREATE');
    const payload = row.payloadJson as { code: { coding: Array<{ code: string }> } };
    expect(payload.code.coding[0]?.code).toBe('M17.11');
    expect(payload.code.coding[0]?.code).not.toBe('I10');
  });

  it('PATCH payload preserves trigger kind for reconcile-update-case-icd', () => {
    const row = proposeWriteBack(
      baseInput({
        case: {
          id: 'case_knee',
          primaryIcd: 'M17.12',
          primaryIcdLabel: 'Left knee OA',
          status: 'ACTIVE',
          mirrorsFhirConditionId: 'cond_knee',
        },
        existingCondition: {
          fhirConditionId: 'cond_knee',
          versionId: '5',
          clinicalStatus: 'active',
          icd: 'M17.11',
          icdLabel: 'Right knee OA',
        },
        trigger: TRIGGER_RECONCILE_UPDATE_ICD,
      }),
    );
    expect(row).not.toBeNull();
    expect(row!.triggerKind).toBe('reconcile-with-mutation');
    expect(row!.driftLogId).toBe('drift_2');
  });
});

// =============================================================================
// Helpers.
// =============================================================================

describe('isWriteBackIdempotencyKey', () => {
  it('returns false for empty string', () => {
    expect(isWriteBackIdempotencyKey('')).toBe(false);
  });
  it('returns false for arbitrary strings', () => {
    expect(isWriteBackIdempotencyKey('not-a-cuid')).toBe(false);
  });
  it('returns false for type mismatches', () => {
    // @ts-expect-error — testing runtime guard
    expect(isWriteBackIdempotencyKey(undefined)).toBe(false);
    // @ts-expect-error — testing runtime guard
    expect(isWriteBackIdempotencyKey(42)).toBe(false);
  });
});
