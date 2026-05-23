import { createId, isCuid } from '@paralleldrive/cuid2';

/**
 * Sprint 0.17 — FHIR Phase D₃ write-back service.
 *
 * Pure payload builders + a thin orchestration function. NO DB calls.
 * NO HTTP. The accept endpoint feeds this with already-projected data
 * (post-tx OS state) and inserts the returned `WriteBackProposalRowShape`
 * into `FhirWriteBackProposal`; the worker reads the row + dispatches
 * to the FHIR client.
 *
 * Anti-regression rule 24 (data only, no clinical recommendations):
 * this module CONSTRUCTS the FHIR payload; it does NOT decide whether
 * to send it. The clinician's explicit approve click is what gates the
 * worker job. Every field is derived from OS state (the case + the
 * clinician + the patient identity); we never hallucinate FHIR-side
 * data here.
 *
 * Anti-regression rule 20 (verified sources only): write-back targets
 * only the patient identity link the accept endpoint already verified;
 * the orchestration function rejects calls where the linked
 * `patient.fhirPatientId` is absent — defense in depth, the accept
 * endpoint should have gated on this already.
 */

// =============================================================================
// Coding-system constants.
// =============================================================================

/** FHIR R4 code system for ICD-10-CM. The EHR may rewrite codes into a
 *  vendor-specific value set; for OS-originated writes we always send
 *  ICD-10-CM because that's the system OmniScribe codes against
 *  internally (Sprints 0.11+). */
export const ICD_10_CM_SYSTEM = 'http://hl7.org/fhir/sid/icd-10-cm';

/** FHIR R4 Condition.clinicalStatus value set. */
export const FHIR_CLINICAL_STATUS_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/condition-clinical';

/** OS-origin extension URL. Stamped on every CREATE so an external
 *  auditor can identify OS-originated Conditions vs. native EHR
 *  entries. Pinned to a stable identifier even though the FHIR
 *  registration is deferred. */
export const OMNISCRIBE_ORIGIN_EXTENSION_URL =
  'https://omniscribe.health/fhir/StructureDefinition/omniscribe-origin';

// =============================================================================
// Input shapes the accept endpoint + worker feed in.
// =============================================================================

export type CaseWriteBackTrigger =
  | { kind: 'open-new'; caseRouterRunId: string }
  | { kind: 'open-new-from-condition'; caseRouterRunId: string }
  | {
      kind: 'reconcile-with-mutation';
      caseRouterRunId: string;
      driftLogId: string;
      resolution:
        | 'reopen-case'
        | 'close-case'
        | 'open-new-case'
        | 'update-case-icd';
    };

export type CaseSnapshotForWriteBack = {
  id: string;
  /** Required for write-back — defense in depth (the accept endpoint
   *  gates on this before calling). The OS case must carry a coded
   *  ICD; "Needs coding" cases never produce a proposal. */
  primaryIcd: string;
  primaryIcdLabel: string;
  status: 'ACTIVE' | 'CLOSED' | 'CANCELLED' | 'PENDING_ROUTER';
  /** When non-null, an existing EHR Condition exists — the operation
   *  becomes PATCH instead of CREATE. */
  mirrorsFhirConditionId: string | null;
};

export type PatientSnapshotForWriteBack = {
  id: string;
  /** Required — write-back targets ONLY a verified FHIR patient
   *  identity. `proposeWriteBack` throws if this is missing (rule 20
   *  defense). */
  fhirPatientId: string;
};

export type ClinicianSnapshotForWriteBack = {
  orgUserId: string;
  /** Display string for the FHIR `recorder.display` field — typically
   *  the clinician's full name (e.g. "Dr. Jane Mitchell, MD"). The
   *  accept endpoint projects this from the session user. */
  recorderRefDisplay: string;
};

/** Optional cached EHR Condition state used to build a minimal JSON
 *  Patch for PATCH operations. Sourced from
 *  `FhirCachedResource.simplified` (Sprint 0.16's drift detection
 *  already loads these). */
export type ExistingConditionSnapshot = {
  fhirConditionId: string;
  /** Captured at drift-detection time. Sent as `If-Match` on PATCH
   *  (decision 6). Absent if the F3 sync hasn't populated meta yet —
   *  the worker fails closed when ifMatchVersion is null on PATCH. */
  versionId: string | null;
  clinicalStatus:
    | 'active'
    | 'recurrence'
    | 'relapse'
    | 'resolved'
    | 'remission';
  icd: string;
  icdLabel: string;
};

export type BuildPayloadInput = {
  case: CaseSnapshotForWriteBack;
  patient: PatientSnapshotForWriteBack;
  clinician: ClinicianSnapshotForWriteBack;
  /** PATCH-only — null for CREATE flows. */
  existingCondition: ExistingConditionSnapshot | null;
  trigger: CaseWriteBackTrigger;
  /** Optional clock injection for tests + idempotent re-runs. Defaults
   *  to `new Date()`. */
  now?: Date;
};

// =============================================================================
// FHIR R4 payload shapes (just narrow enough for typing — the wire
// shape is the canonical truth at the EHR layer).
// =============================================================================

export type FhirCodeableConcept = {
  coding: Array<{ system: string; code: string; display?: string }>;
  text?: string;
};

export type FhirExtension = {
  url: string;
  valueString?: string;
  valueCode?: string;
  valueDateTime?: string;
};

export type FhirCreateConditionPayload = {
  resourceType: 'Condition';
  meta?: { tag?: FhirCodeableConcept['coding']; extension?: FhirExtension[] };
  extension?: FhirExtension[];
  clinicalStatus: FhirCodeableConcept;
  code: FhirCodeableConcept;
  subject: { reference: string };
  recorder?: { display: string };
  recordedDate: string;
};

export type JsonPatchOp = {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
};

// =============================================================================
// Status mappers.
// =============================================================================

/** Maps OS `CaseManagement.status` → FHIR `Condition.clinicalStatus`
 *  coding. CANCELLED + PENDING_ROUTER never reach write-back (the gate
 *  in the accept endpoint excludes them); we map defensively anyway. */
export function mapCaseStatusToFhirClinicalStatus(
  status: CaseSnapshotForWriteBack['status'],
): 'active' | 'resolved' {
  if (status === 'CLOSED') return 'resolved';
  // ACTIVE, CANCELLED, PENDING_ROUTER → active (the only non-trivial
  // case is CLOSED → resolved per decision 4: we PATCH status rather
  // than DELETE the Condition).
  return 'active';
}

function clinicalStatusCoding(status: 'active' | 'resolved'): FhirCodeableConcept {
  return {
    coding: [{ system: FHIR_CLINICAL_STATUS_SYSTEM, code: status }],
  };
}

function icdCoding(icd: string, label: string): FhirCodeableConcept {
  return {
    coding: [{ system: ICD_10_CM_SYSTEM, code: icd, display: label }],
    text: label,
  };
}

// =============================================================================
// Payload builders — pure.
// =============================================================================

/**
 * Build the FHIR R4 Condition resource for a CREATE write-back.
 *
 * Every field is derived from OS state:
 *   - `subject.reference`  ← `Patient/<fhirPatientId>` (the verified link)
 *   - `code`               ← OS case's ICD + label
 *   - `clinicalStatus`     ← OS case.status mapped via the helper above
 *   - `recorder`           ← clinician display string from the session
 *   - `recordedDate`       ← now (the moment the clinician confirmed)
 *   - `extension`          ← OS-origin marker so an external auditor
 *                            can identify Conditions OmniScribe wrote.
 *
 * The function rejects calls where the OS case doesn't carry a coded
 * ICD ("Needs coding") — defense in depth; the accept endpoint should
 * already have gated on this.
 */
export function buildCreateConditionPayload(
  input: BuildPayloadInput,
): FhirCreateConditionPayload {
  assertWriteBackPreconditions(input);
  const now = input.now ?? new Date();
  const clinical = mapCaseStatusToFhirClinicalStatus(input.case.status);

  return {
    resourceType: 'Condition',
    extension: [
      {
        url: OMNISCRIBE_ORIGIN_EXTENSION_URL,
        valueString: `omniscribe-case:${input.case.id}`,
      },
    ],
    clinicalStatus: clinicalStatusCoding(clinical),
    code: icdCoding(input.case.primaryIcd, input.case.primaryIcdLabel),
    subject: { reference: `Patient/${input.patient.fhirPatientId}` },
    recorder: { display: input.clinician.recorderRefDisplay },
    recordedDate: now.toISOString(),
  };
}

/**
 * Build the RFC 6902 JSON Patch ops for a PATCH write-back. Returns
 * the MINIMAL set of operations needed to bring the FHIR Condition
 * into agreement with the OS case — never a full-resource overwrite
 * (decision 5).
 *
 * Two independent op kinds:
 *   - status flip:  `replace /clinicalStatus` when the mapped OS
 *                   status differs from the cached condition's
 *                   clinicalStatus.
 *   - ICD update:   `replace /code` when the OS case's primaryIcd
 *                   differs from the cached condition's icd.
 *
 * Both can fire in the same patch (deterministic order: clinicalStatus
 * first, then code) when a single reconcile resolution mutates both.
 *
 * Returns an EMPTY array when nothing actually changed — the caller
 * should treat that as a no-op (no proposal row, no FHIR call). The
 * accept endpoint gates so this generally won't happen in production;
 * tests rely on the empty-result behaviour for the no-drift edge case.
 */
export function buildPatchOperations(input: BuildPayloadInput): JsonPatchOp[] {
  assertWriteBackPreconditions(input);
  if (!input.existingCondition) {
    throw new WriteBackInputError(
      'patch_requires_existing_condition',
      'buildPatchOperations called without existingCondition',
    );
  }

  const ops: JsonPatchOp[] = [];

  // Status flip — derive from OS, compare to cached condition.
  const targetClinical = mapCaseStatusToFhirClinicalStatus(input.case.status);
  const cachedClinical = collapseConditionStatusToActiveResolved(
    input.existingCondition.clinicalStatus,
  );
  if (targetClinical !== cachedClinical) {
    ops.push({
      op: 'replace',
      path: '/clinicalStatus',
      value: clinicalStatusCoding(targetClinical),
    });
  }

  // ICD update — fire only when the OS case's coded ICD differs from
  // the cached Condition's coded ICD. We do NOT fire when one side is
  // null because that's "Needs coding" territory, not drift.
  if (
    input.case.primaryIcd &&
    input.existingCondition.icd &&
    input.case.primaryIcd !== input.existingCondition.icd
  ) {
    ops.push({
      op: 'replace',
      path: '/code',
      value: icdCoding(input.case.primaryIcd, input.case.primaryIcdLabel),
    });
  }

  return ops;
}

/** Collapse the wider FHIR clinicalStatus union onto our two-state
 *  active/resolved view so PATCH diffs are stable. */
function collapseConditionStatusToActiveResolved(
  status: ExistingConditionSnapshot['clinicalStatus'],
): 'active' | 'resolved' {
  if (status === 'resolved' || status === 'remission') return 'resolved';
  return 'active';
}

// =============================================================================
// Orchestration — decide CREATE vs PATCH + generate the proposal row.
// =============================================================================

export type WriteBackProposalRowShape = {
  operation: 'CREATE' | 'PATCH';
  payloadJson: FhirCreateConditionPayload | JsonPatchOp[];
  /** Null for CREATE. Populated for PATCH (the EHR resource id). */
  fhirConditionId: string | null;
  /** Null for CREATE. Populated for PATCH from
   *  `existingCondition.versionId`. The worker will fail-closed if
   *  this is null on a PATCH at write time (the EHR's optimistic
   *  concurrency control can't run without a version). */
  ifMatchVersion: string | null;
  /** cuid2 — sent as X-Request-Id on the upstream FHIR call. Unique;
   *  the DB unique constraint catches double-proposal scenarios. */
  idempotencyKey: string;
  /** Trigger metadata threaded through for the
   *  `FhirWriteBackProposal.triggerKind` + lineage FKs. */
  triggerKind: CaseWriteBackTrigger['kind'];
  caseRouterRunId: string;
  driftLogId: string | null;
};

/**
 * Decide CREATE vs PATCH from OS state, build the payload, generate
 * the idempotency key. The accept endpoint inserts the returned row
 * into `FhirWriteBackProposal` (status PROPOSED) in the same tx as
 * the case mutation.
 *
 * Returns `null` when the operation would be a no-op:
 *   - PATCH with zero patch ops (the OS case and the cached EHR
 *     Condition already agree).
 * The caller should treat null as "no proposal row needed."
 *
 * Throws `WriteBackInputError` for defense-in-depth violations:
 *   - Missing `patient.fhirPatientId` (rule 20 — no unverified write).
 *   - PATCH trigger without `existingCondition` (orchestrator can't
 *     build a patch without the cached state).
 *   - CANCELLED / PENDING_ROUTER case statuses (write-back gate
 *     should never have admitted these).
 */
export function proposeWriteBack(
  input: BuildPayloadInput,
): WriteBackProposalRowShape | null {
  const isCreate = input.case.mirrorsFhirConditionId === null;
  const triggerKind = input.trigger.kind;
  const idempotencyKey = createId();
  const lineage = {
    triggerKind,
    caseRouterRunId: input.trigger.caseRouterRunId,
    driftLogId:
      input.trigger.kind === 'reconcile-with-mutation'
        ? input.trigger.driftLogId
        : null,
  };

  if (isCreate) {
    const payload = buildCreateConditionPayload(input);
    return {
      operation: 'CREATE',
      payloadJson: payload,
      fhirConditionId: null,
      ifMatchVersion: null,
      idempotencyKey,
      ...lineage,
    };
  }

  // PATCH path.
  if (!input.existingCondition) {
    throw new WriteBackInputError(
      'patch_requires_existing_condition',
      'proposeWriteBack: PATCH trigger without existingCondition',
    );
  }
  const ops = buildPatchOperations(input);
  if (ops.length === 0) {
    // No-op — OS and EHR already agree.
    return null;
  }
  return {
    operation: 'PATCH',
    payloadJson: ops,
    fhirConditionId: input.existingCondition.fhirConditionId,
    ifMatchVersion: input.existingCondition.versionId,
    idempotencyKey,
    ...lineage,
  };
}

// =============================================================================
// Defensive validation.
// =============================================================================

export type WriteBackInputErrorCode =
  | 'missing_fhir_patient_id'
  | 'patch_requires_existing_condition'
  | 'case_not_coded'
  | 'case_status_not_writable';

export class WriteBackInputError extends Error {
  readonly code: WriteBackInputErrorCode;
  constructor(code: WriteBackInputErrorCode, message: string) {
    // Prefix the message with the code so callers using
    // `.toThrow(/code_token/)` matches work, and so logs carry the
    // categorical reason without a separate field lookup.
    super(`${code}: ${message}`);
    this.name = 'WriteBackInputError';
    this.code = code;
  }
}

function assertWriteBackPreconditions(input: BuildPayloadInput): void {
  if (!input.patient.fhirPatientId) {
    throw new WriteBackInputError(
      'missing_fhir_patient_id',
      'Write-back requires a verified PatientFhirIdentity.fhirPatientId',
    );
  }
  if (!input.case.primaryIcd) {
    // Defense in depth — the accept endpoint should have gated on this.
    // "Needs coding" cases never produce a proposal because the FHIR
    // Condition requires a coded value.
    throw new WriteBackInputError(
      'case_not_coded',
      'Write-back requires a coded ICD on the OS case',
    );
  }
  if (
    input.case.status === 'CANCELLED' ||
    input.case.status === 'PENDING_ROUTER'
  ) {
    throw new WriteBackInputError(
      'case_status_not_writable',
      `Write-back not eligible for case status ${input.case.status}`,
    );
  }
}

/** Sanity helper for tests — confirms an idempotencyKey is a real
 *  cuid2. Exported so the test suite can assert the shape without
 *  reaching into the cuid2 library directly. */
export function isWriteBackIdempotencyKey(value: string): boolean {
  return typeof value === 'string' && isCuid(value);
}
