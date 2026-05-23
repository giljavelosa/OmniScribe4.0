import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * Sprint 0.17 — fhir-writeback worker tests.
 *
 * Coverage targets per the spec's "Worker tests" (10+ cases):
 *   - Happy path CREATE → SUCCEEDED + back-fills CaseManagement.mirrorsFhirConditionId
 *   - Happy path PATCH status → SUCCEEDED + resultFhirVersion updated
 *   - Happy path PATCH ICD → SUCCEEDED
 *   - Org toggle off between approve and pickup → CANCELLED + audit
 *   - Proposal already CANCELLED → drop silently (no audit, no FHIR call)
 *   - TRANSIENT failure → FAILED + throws (BullMQ retries)
 *   - PERMANENT failure (403) → FAILED + does NOT throw
 *   - CONFLICT failure (412) → FAILED + does NOT throw
 *   - failureCount increments on each call
 *   - Missing FHIR identity → PERMANENT failure + audit
 *   - Audit row written for every terminal status (rule 8 spot-check)
 *
 * Test mocking note: `src/lib/queue.ts` is NOT imported here — the
 * handler doesn't enqueue anything; the worker is itself the consumer.
 */

const proposalFindUnique = vi.fn();
const proposalUpdate = vi.fn();
const orgEhrConnectionFindFirst = vi.fn();
const fhirIdentityFindFirst = vi.fn();
const caseManagementUpdate = vi.fn();
const txMock = vi.fn();
const writeAuditLog = vi.fn();
const createConditionMock = vi.fn();
const patchConditionMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    fhirWriteBackProposal: {
      findUnique: (...a: unknown[]) => proposalFindUnique(...a),
      update: (...a: unknown[]) => proposalUpdate(...a),
    },
    orgEhrConnection: {
      findFirst: (...a: unknown[]) => orgEhrConnectionFindFirst(...a),
    },
    fhirIdentity: {
      findFirst: (...a: unknown[]) => fhirIdentityFindFirst(...a),
    },
    caseManagement: {
      update: (...a: unknown[]) => caseManagementUpdate(...a),
    },
    $transaction: (writes: unknown[]) => txMock(writes),
  },
}));

vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

vi.mock('@/services/fhir/patient-client', async () => {
  const actual = await vi.importActual<
    typeof import('@/services/fhir/patient-client')
  >('@/services/fhir/patient-client');
  return {
    ...actual,
    createCondition: (...a: unknown[]) => createConditionMock(...a),
    patchCondition: (...a: unknown[]) => patchConditionMock(...a),
  };
});

import { handle } from '@/workers/fhir-writeback/handler';

function approvedProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wbp_1',
    orgId: 'org_1',
    caseManagementId: 'case_1',
    patientId: 'pat_1',
    proposedByUserId: 'user_1',
    triggerKind: 'open-new',
    caseRouterRunId: 'run_1',
    driftLogId: null,
    operation: 'CREATE',
    fhirConditionId: null,
    payloadJson: { resourceType: 'Condition' },
    ifMatchVersion: null,
    idempotencyKey: 'idemp_abc',
    status: 'APPROVED',
    proposedAt: new Date(),
    approvedAt: new Date(),
    approvedByUserId: 'user_1',
    executingAt: null,
    succeededAt: null,
    failedAt: null,
    cancelledAt: null,
    cancelledByUserId: null,
    resultFhirId: null,
    resultFhirVersion: null,
    failureKind: null,
    failureMessage: null,
    failureCount: 0,
    ...overrides,
  };
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    data: { proposalId: 'wbp_1', ...overrides },
    attemptsMade: 0,
  } as never;
}

function fhirEnabledOrg() {
  orgEhrConnectionFindFirst
    .mockResolvedValueOnce({ writebackEnabled: true })
    .mockResolvedValueOnce({ ehrSystem: 'nextgen' });
  fhirIdentityFindFirst.mockResolvedValueOnce({
    id: 'fhir-id-1',
    fhirBaseUrl: 'https://fhir.example.test',
    ehrSystem: 'nextgen',
    accessTokenEnc: 'enc',
    refreshTokenEnc: 'enc',
    expiresAt: new Date(Date.now() + 3600_000),
    scope: 'patient/Condition.write',
  });
}

beforeEach(() => {
  proposalFindUnique.mockReset();
  proposalUpdate.mockReset();
  orgEhrConnectionFindFirst.mockReset();
  fhirIdentityFindFirst.mockReset();
  caseManagementUpdate.mockReset();
  txMock.mockReset();
  writeAuditLog.mockReset();
  createConditionMock.mockReset();
  patchConditionMock.mockReset();
  // $transaction default — accept the writes + return ok.
  txMock.mockResolvedValue([{}]);
});

describe('fhir-writeback worker handler', () => {
  it('drops silently when the proposal does not exist (no audit row to anchor)', async () => {
    proposalFindUnique.mockResolvedValueOnce(null);
    const result = await handle(makeJob());
    expect(result).toMatchObject({ skipped: 'not_found' });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('drops silently when the proposal is already CANCELLED', async () => {
    proposalFindUnique.mockResolvedValueOnce(approvedProposal({ status: 'CANCELLED' }));
    const result = await handle(makeJob());
    expect(result).toMatchObject({ skipped: 'not_approved', status: 'CANCELLED' });
    expect(createConditionMock).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('CANCELLED when writebackEnabled flipped off between approve and pickup', async () => {
    proposalFindUnique.mockResolvedValueOnce(approvedProposal());
    orgEhrConnectionFindFirst.mockResolvedValueOnce({ writebackEnabled: false });

    const result = await handle(makeJob());
    expect(result).toMatchObject({ cancelled: 'org_writeback_disabled' });
    // Status update to CANCELLED.
    expect(proposalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wbp_1' },
        data: expect.objectContaining({
          status: 'CANCELLED',
          failureMessage: 'org_writeback_disabled',
        }),
      }),
    );
    // FHIR client never called.
    expect(createConditionMock).not.toHaveBeenCalled();
    // Audit fired with worker_recheck reason + persona version.
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FHIR_WRITEBACK_CANCELLED',
        metadata: expect.objectContaining({
          cancelReason: 'worker_recheck',
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
  });

  it('happy-path CREATE → SUCCEEDED + back-fills mirrorsFhirConditionId', async () => {
    proposalFindUnique.mockResolvedValueOnce(approvedProposal());
    fhirEnabledOrg();
    createConditionMock.mockResolvedValueOnce({
      ok: true,
      fhirId: 'cond_new_123',
      versionId: '1',
    });

    await handle(makeJob());

    // EXECUTING transition before the upstream call.
    expect(proposalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wbp_1' },
        data: expect.objectContaining({ status: 'EXECUTING' }),
      }),
    );
    // SUCCEEDED transition + case back-fill in one $transaction.
    expect(txMock).toHaveBeenCalled();
    // The transaction body included both writes (proposal update + case update).
    const txWrites = txMock.mock.calls[0]?.[0];
    expect(Array.isArray(txWrites) ? txWrites.length : 0).toBe(2);
    // Audit row fired with the resulting fhir id.
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FHIR_WRITEBACK_SUCCEEDED',
        metadata: expect.objectContaining({
          proposalId: 'wbp_1',
          resultFhirId: 'cond_new_123',
          resultFhirVersion: '1',
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
  });

  it('happy-path PATCH status → SUCCEEDED with new versionId; case is NOT re-mirrored (already linked)', async () => {
    proposalFindUnique.mockResolvedValueOnce(
      approvedProposal({
        operation: 'PATCH',
        fhirConditionId: 'cond_existing',
        ifMatchVersion: '4',
        payloadJson: [{ op: 'replace', path: '/clinicalStatus', value: {} }],
      }),
    );
    fhirEnabledOrg();
    patchConditionMock.mockResolvedValueOnce({
      ok: true,
      fhirId: 'cond_existing',
      versionId: '5',
    });

    await handle(makeJob());

    expect(patchConditionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fhirConditionId: 'cond_existing',
        ifMatchVersion: '4',
      }),
    );
    // PATCH path inserts a SUCCEEDED update — only ONE write in the
    // transaction (no case back-fill, the mirror already exists).
    const txWrites = txMock.mock.calls[0]?.[0];
    expect(Array.isArray(txWrites) ? txWrites.length : 0).toBe(1);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FHIR_WRITEBACK_SUCCEEDED',
        metadata: expect.objectContaining({
          operation: 'PATCH',
          resultFhirId: 'cond_existing',
          resultFhirVersion: '5',
        }),
      }),
    );
  });

  it('TRANSIENT failure → FAILED + handler THROWS so BullMQ retries (rule 10)', async () => {
    proposalFindUnique.mockResolvedValueOnce(approvedProposal());
    fhirEnabledOrg();
    createConditionMock.mockResolvedValueOnce({
      ok: false,
      failureKind: 'TRANSIENT',
      status: 502,
      message: 'Bad Gateway',
    });

    await expect(handle(makeJob())).rejects.toThrow(/fhir-writeback-transient/);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FHIR_WRITEBACK_FAILED',
        metadata: expect.objectContaining({
          failureKind: 'TRANSIENT',
          status: 502,
          failureCount: 1, // initial failureCount 0 + increment
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
  });

  it('PERMANENT failure → FAILED + handler does NOT throw (no BullMQ retry)', async () => {
    proposalFindUnique.mockResolvedValueOnce(approvedProposal());
    fhirEnabledOrg();
    createConditionMock.mockResolvedValueOnce({
      ok: false,
      failureKind: 'PERMANENT',
      status: 403,
      message: 'forbidden',
    });

    const result = await handle(makeJob());
    expect(result).toMatchObject({ failed: 'permanent_or_conflict', failureKind: 'PERMANENT' });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FHIR_WRITEBACK_FAILED',
        metadata: expect.objectContaining({ failureKind: 'PERMANENT' }),
      }),
    );
  });

  it('CONFLICT failure (412) → FAILED + does NOT throw', async () => {
    proposalFindUnique.mockResolvedValueOnce(
      approvedProposal({
        operation: 'PATCH',
        fhirConditionId: 'cond_existing',
        ifMatchVersion: '4',
      }),
    );
    fhirEnabledOrg();
    patchConditionMock.mockResolvedValueOnce({
      ok: false,
      failureKind: 'CONFLICT',
      status: 412,
      message: 'precondition_failed',
    });

    const result = await handle(makeJob());
    expect(result).toMatchObject({ failed: 'permanent_or_conflict', failureKind: 'CONFLICT' });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FHIR_WRITEBACK_FAILED',
        metadata: expect.objectContaining({ failureKind: 'CONFLICT', status: 412 }),
      }),
    );
  });

  it('failureCount increments by 1 each call (initial 2 → audited 3)', async () => {
    proposalFindUnique.mockResolvedValueOnce(approvedProposal({ failureCount: 2 }));
    fhirEnabledOrg();
    createConditionMock.mockResolvedValueOnce({
      ok: false,
      failureKind: 'PERMANENT',
      status: 422,
      message: 'unprocessable_entity',
    });

    await handle(makeJob());

    // The DB increment is via Prisma's increment helper.
    expect(proposalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureCount: { increment: 1 },
        }),
      }),
    );
    // The audit metadata reports the post-increment value.
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FHIR_WRITEBACK_FAILED',
        metadata: expect.objectContaining({ failureCount: 3 }),
      }),
    );
  });

  it('missing FHIR identity → PERMANENT failure + audit', async () => {
    proposalFindUnique.mockResolvedValueOnce(approvedProposal());
    orgEhrConnectionFindFirst
      .mockResolvedValueOnce({ writebackEnabled: true })
      .mockResolvedValueOnce({ ehrSystem: 'nextgen' });
    fhirIdentityFindFirst.mockResolvedValueOnce(null);

    const result = await handle(makeJob());
    expect(result).toMatchObject({ failed: 'no_active_fhir_identity' });
    expect(createConditionMock).not.toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FHIR_WRITEBACK_FAILED',
        metadata: expect.objectContaining({
          failureKind: 'PERMANENT',
        }),
      }),
    );
  });
});
