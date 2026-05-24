import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * Sprint 0.13 — POST /api/notes/[id]/case-router/accept tests.
 *
 * Three coverage targets per the spec's "Verify when done":
 *   - Confirming an `attach` proposal rebinds the encounter to the chosen
 *     case AND deletes the source PENDING_ROUTER case (atomic).
 *   - Confirming an `open-new` proposal promotes the pending case to
 *     ACTIVE in-place (no rebind needed).
 *   - "Change manually" override fires CASE_ROUTER_OVERRIDDEN.
 *
 * Plus the negatives:
 *   - 404 when the run is not found.
 *   - 409 when the run is already accepted.
 *   - 403 when the caller isn't the note's clinician (and isn't an admin).
 */

const noteFindFirst = vi.fn();
const caseRouterRunFindFirst = vi.fn();
const txMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    note: { findFirst: (...a: unknown[]) => noteFindFirst(...a) },
    caseRouterRun: { findFirst: (...a: unknown[]) => caseRouterRunFindFirst(...a) },
    $transaction: (cb: (tx: unknown) => Promise<unknown>) => txMock(cb),
  },
}));

const requireFeatureAccess = vi.fn();
vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccess(...a),
}));

const writeAuditLog = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

vi.mock('@/lib/phi-access', () => ({
  assertOrgScoped: vi.fn(),
}));

// Stub @/lib/queue so route.ts's transitive import of @/lib/redis (which
// throws at module-load when REDIS_URL is unset) is broken. The accept
// route invokes `enqueueCleoStateRefresh` on success; we mock it as a no-op
// — the test asserts the audit + DB side effects, not the queue side effect
// (queue throttle is tested in test/workers/cleo-state-handler.test.ts).
vi.mock('@/lib/queue', () => ({
  enqueueCleoStateRefresh: vi.fn(),
}));

import { POST } from '@/app/api/notes/[id]/case-router/accept/route';

function authedAsClinician() {
  requireFeatureAccess.mockResolvedValueOnce({
    user: { id: 'user_1' },
    authorizationUser: { orgId: 'org_1', orgUserId: 'ou_1', role: 'CLINICIAN' },
    orgUser: { id: 'ou_1', orgId: 'org_1' },
  });
}

function buildRequest(body: unknown) {
  return new Request('http://test.local/api/notes/note_1/case-router/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Sprint 0.17 default: writebackEnabled = false on the org's
 * connection. Mixed into every tx mock so the new write-back gate in
 * `maybeInsertWriteBackProposal` short-circuits cleanly for Sprint
 * 0.13 / 0.15 / 0.16 scenarios that don't exercise write-back. Tests
 * that DO exercise write-back override the mock per-test.
 */
function writebackOffDefaults() {
  return {
    orgEhrConnection: {
      findFirst: vi.fn().mockResolvedValue({ writebackEnabled: false }),
    },
    patientFhirIdentity: { findFirst: vi.fn().mockResolvedValue(null) },
    fhirCachedResource: { findFirst: vi.fn().mockResolvedValue(null) },
    fhirWriteBackProposal: {
      create: vi.fn(),
    },
  };
}

beforeEach(() => {
  noteFindFirst.mockReset();
  caseRouterRunFindFirst.mockReset();
  txMock.mockReset();
  requireFeatureAccess.mockReset();
  writeAuditLog.mockReset();
});

describe('POST /api/notes/[id]/case-router/accept', () => {
  it('accepts an "attach" proposal: rebinds encounter + deletes PENDING_ROUTER case', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_1',
      orgId: 'org_1',
      patientId: 'pat_1',
      status: 'DRAFT',
      clinicianOrgUserId: 'ou_1',
      encounterId: 'enc_1',
      encounter: { id: 'enc_1', caseManagementId: 'case_pending' },
    });
    caseRouterRunFindFirst.mockResolvedValueOnce({
      id: 'run_1',
      orgId: 'org_1',
      noteId: 'note_1',
      acceptedAction: null,
      proposalJson: {
        action: 'attach',
        caseManagementId: 'case_existing',
        confidence: 'high',
        reasoning: 'Continues your active case.',
        alternatives: [],
      },
    });

    const tx = {
      ...writebackOffDefaults(),
      caseManagement: {
        findUnique: vi.fn().mockResolvedValueOnce({
          id: 'case_pending',
          status: 'PENDING_ROUTER',
        }),
        findFirst: vi.fn().mockResolvedValueOnce({
          id: 'case_existing',
          status: 'ACTIVE',
          secondaryIcd: null,
          secondaryIcdLabel: null,
        }),
        delete: vi.fn().mockResolvedValueOnce({}),
      },
      encounter: {
        update: vi.fn().mockResolvedValueOnce({}),
      },
      caseRouterRun: {
        update: vi.fn().mockResolvedValueOnce({}),
      },
    };
    txMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const res = await POST(
      buildRequest({ caseRouterRunId: 'run_1', decision: { kind: 'accept' } }),
      { params: Promise.resolve({ id: 'note_1' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      caseRouterRunId: 'run_1',
      caseManagementId: 'case_existing',
      override: false,
    });
    expect(tx.encounter.update).toHaveBeenCalledWith({
      where: { id: 'enc_1' },
      data: { caseManagementId: 'case_existing' },
    });
    expect(tx.caseManagement.delete).toHaveBeenCalledWith({
      where: { id: 'case_pending' },
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CASE_ROUTER_ACCEPTED',
        metadata: expect.objectContaining({
          caseRouterRunId: 'run_1',
          caseManagementId: 'case_existing',
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
  });

  it('accepts an "open-new" proposal: promotes the pending case in-place', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_2',
      orgId: 'org_1',
      patientId: 'pat_2',
      status: 'DRAFT',
      clinicianOrgUserId: 'ou_1',
      encounterId: 'enc_2',
      encounter: { id: 'enc_2', caseManagementId: 'case_pending_2' },
    });
    caseRouterRunFindFirst.mockResolvedValueOnce({
      id: 'run_2',
      orgId: 'org_1',
      noteId: 'note_2',
      acceptedAction: null,
      proposalJson: {
        action: 'open-new',
        newCase: {
          primaryIcd: 'M25.51',
          primaryIcdLabel: 'Right shoulder pain',
        },
        confidence: 'high',
        reasoning: 'Visit is about a new shoulder problem.',
        alternatives: [],
      },
    });

    const tx = {
      ...writebackOffDefaults(),
      caseManagement: {
        findUnique: vi.fn().mockResolvedValueOnce({
          id: 'case_pending_2',
          status: 'PENDING_ROUTER',
        }),
        update: vi.fn().mockResolvedValueOnce({}),
      },
      caseRouterRun: {
        update: vi.fn().mockResolvedValueOnce({}),
      },
    };
    txMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const res = await POST(
      buildRequest({ caseRouterRunId: 'run_2', decision: { kind: 'accept' } }),
      { params: Promise.resolve({ id: 'note_2' }) },
    );
    expect(res.status).toBe(200);
    expect(tx.caseManagement.update).toHaveBeenCalledWith({
      where: { id: 'case_pending_2' },
      data: expect.objectContaining({
        status: 'ACTIVE',
        primaryIcd: 'M25.51',
        primaryIcdLabel: 'Right shoulder pain',
      }),
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CASE_ROUTER_ACCEPTED' }),
    );
  });

  it('logs CASE_ROUTER_OVERRIDDEN when the chosen action != proposal', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_3',
      orgId: 'org_1',
      patientId: 'pat_3',
      status: 'DRAFT',
      clinicianOrgUserId: 'ou_1',
      encounterId: 'enc_3',
      encounter: { id: 'enc_3', caseManagementId: 'case_pending_3' },
    });
    caseRouterRunFindFirst.mockResolvedValueOnce({
      id: 'run_3',
      orgId: 'org_1',
      noteId: 'note_3',
      acceptedAction: null,
      proposalJson: {
        action: 'open-new',
        newCase: { primaryIcd: null, primaryIcdLabel: 'Routing in progress' },
        confidence: 'low',
        reasoning: 'unclear',
        alternatives: [],
      },
    });

    const tx = {
      ...writebackOffDefaults(),
      caseManagement: {
        findUnique: vi.fn().mockResolvedValueOnce({
          id: 'case_pending_3',
          status: 'PENDING_ROUTER',
        }),
        findFirst: vi.fn().mockResolvedValueOnce({
          id: 'case_other',
          status: 'ACTIVE',
          secondaryIcd: null,
          secondaryIcdLabel: null,
        }),
        delete: vi.fn().mockResolvedValueOnce({}),
      },
      encounter: {
        update: vi.fn().mockResolvedValueOnce({}),
      },
      caseRouterRun: {
        update: vi.fn().mockResolvedValueOnce({}),
      },
    };
    txMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const res = await POST(
      buildRequest({
        caseRouterRunId: 'run_3',
        decision: { kind: 'attach', caseManagementId: 'case_other' },
      }),
      { params: Promise.resolve({ id: 'note_3' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.override).toBe(true);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CASE_ROUTER_OVERRIDDEN',
        metadata: expect.objectContaining({
          proposedAction: 'open-new',
          chosenAction: 'attach',
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
  });

  it('rejects accept on a synthetic fallback proposal (null ICD + placeholder label) with 400 manual_coding_required', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_fb',
      orgId: 'org_1',
      patientId: 'pat_fb',
      status: 'DRAFT',
      clinicianOrgUserId: 'ou_1',
      encounterId: 'enc_fb',
      encounter: { id: 'enc_fb', caseManagementId: 'case_pending_fb' },
    });
    caseRouterRunFindFirst.mockResolvedValueOnce({
      id: 'run_fb',
      orgId: 'org_1',
      noteId: 'note_fb',
      acceptedAction: null,
      proposalJson: {
        action: 'open-new',
        newCase: { primaryIcd: null, primaryIcdLabel: 'Routing in progress' },
        confidence: 'low',
        reasoning: 'Auto-route unavailable — pick manually.',
        alternatives: [],
      },
    });

    const res = await POST(
      buildRequest({ caseRouterRunId: 'run_fb', decision: { kind: 'accept' } }),
      { params: Promise.resolve({ id: 'note_fb' }) },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('manual_coding_required');
    // Guard fires BEFORE the transaction — no case mutation, no audit row.
    expect(txMock).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('returns 404 when the case-router run does not exist', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_404',
      orgId: 'org_1',
      patientId: 'pat_x',
      status: 'DRAFT',
      clinicianOrgUserId: 'ou_1',
      encounterId: 'enc_x',
      encounter: { id: 'enc_x', caseManagementId: 'case_x' },
    });
    caseRouterRunFindFirst.mockResolvedValueOnce(null);

    const res = await POST(
      buildRequest({ caseRouterRunId: 'run_missing', decision: { kind: 'accept' } }),
      { params: Promise.resolve({ id: 'note_404' }) },
    );
    expect(res.status).toBe(404);
  });

  it('returns 409 when the run was already accepted', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_done',
      orgId: 'org_1',
      patientId: 'pat_done',
      status: 'DRAFT',
      clinicianOrgUserId: 'ou_1',
      encounterId: 'enc_done',
      encounter: { id: 'enc_done', caseManagementId: 'case_done' },
    });
    caseRouterRunFindFirst.mockResolvedValueOnce({
      id: 'run_done',
      orgId: 'org_1',
      noteId: 'note_done',
      acceptedAction: 'accepted',
      proposalJson: { action: 'open-new', confidence: 'low', reasoning: 'x', alternatives: [] },
    });

    const res = await POST(
      buildRequest({ caseRouterRunId: 'run_done', decision: { kind: 'accept' } }),
      { params: Promise.resolve({ id: 'note_done' }) },
    );
    expect(res.status).toBe(409);
  });

  it('returns 403 when the caller is not the note author and not an admin', async () => {
    requireFeatureAccess.mockResolvedValueOnce({
      user: { id: 'user_other' },
      authorizationUser: { orgId: 'org_1', orgUserId: 'ou_OTHER', role: 'CLINICIAN' },
      orgUser: { id: 'ou_OTHER', orgId: 'org_1' },
    });
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_x',
      orgId: 'org_1',
      patientId: 'pat_x',
      status: 'DRAFT',
      clinicianOrgUserId: 'ou_AUTHOR',
      encounterId: 'enc_x',
      encounter: { id: 'enc_x', caseManagementId: 'case_x' },
    });

    const res = await POST(
      buildRequest({ caseRouterRunId: 'run_x', decision: { kind: 'accept' } }),
      { params: Promise.resolve({ id: 'note_x' }) },
    );
    expect(res.status).toBe(403);
  });

  it('Sprint 0.15: accepts an "open-new-from-condition" proposal — promotes pending case with coded ICD + mirrorsFhirConditionId + emits CASE_FHIR_LINKED', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_fhir',
      orgId: 'org_1',
      patientId: 'pat_fhir',
      status: 'DRAFT',
      clinicianOrgUserId: 'ou_1',
      encounterId: 'enc_fhir',
      encounter: { id: 'enc_fhir', caseManagementId: 'case_pending_fhir' },
    });
    caseRouterRunFindFirst.mockResolvedValueOnce({
      id: 'run_fhir',
      orgId: 'org_1',
      noteId: 'note_fhir',
      acceptedAction: null,
      proposalJson: {
        action: 'open-new-from-condition',
        newCaseFromCondition: {
          fhirConditionId: 'cond_m5481',
          primaryIcd: 'M54.81',
          primaryIcdLabel: 'Cervicogenic headache',
          recordedDate: '2024-08-15',
          recorderName: 'Dr. Patel',
        },
        confidence: 'high',
        reasoning: 'EHR shows Dr. Patel recorded M54.81 on 2024-08-15.',
        alternatives: [],
      },
    });

    const tx = {
      ...writebackOffDefaults(),
      caseManagement: {
        findUnique: vi.fn().mockResolvedValueOnce({
          id: 'case_pending_fhir',
          status: 'PENDING_ROUTER',
        }),
        update: vi.fn().mockResolvedValueOnce({}),
      },
      caseRouterRun: {
        update: vi.fn().mockResolvedValueOnce({}),
      },
    };
    txMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const res = await POST(
      buildRequest({
        caseRouterRunId: 'run_fhir',
        decision: { kind: 'accept' },
      }),
      { params: Promise.resolve({ id: 'note_fhir' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      caseManagementId: 'case_pending_fhir',
      override: false,
    });
    // The case row gets promoted with the coded ICD + the mirror link.
    expect(tx.caseManagement.update).toHaveBeenCalledWith({
      where: { id: 'case_pending_fhir' },
      data: expect.objectContaining({
        status: 'ACTIVE',
        primaryIcd: 'M54.81',
        primaryIcdLabel: 'Cervicogenic headache',
        mirrorsFhirConditionId: 'cond_m5481',
      }),
    });
    // CASE_ROUTER_ACCEPTED fires (proposal accepted, no override).
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CASE_ROUTER_ACCEPTED',
        metadata: expect.objectContaining({
          caseManagementId: 'case_pending_fhir',
          action: 'open-new-from-condition',
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
    // CASE_FHIR_LINKED fires with the FHIR provenance audit metadata.
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CASE_FHIR_LINKED',
        metadata: expect.objectContaining({
          caseManagementId: 'case_pending_fhir',
          caseRouterRunId: 'run_fhir',
          fhirConditionId: 'cond_m5481',
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
  });

  // ===========================================================================
  // Sprint 0.16 — reconcile resolution branches.
  // ===========================================================================

  it('Sprint 0.16: resolves a STATUS drift with "reopen-case" — flips drifted case to ACTIVE + rebinds + resolves drift log + audits', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_drift',
      orgId: 'org_1',
      patientId: 'pat_drift',
      status: 'DRAFT',
      clinicianOrgUserId: 'ou_1',
      encounterId: 'enc_d',
      encounter: { id: 'enc_d', caseManagementId: 'case_pending_d' },
    });
    caseRouterRunFindFirst.mockResolvedValueOnce({
      id: 'run_d',
      orgId: 'org_1',
      noteId: 'note_drift',
      acceptedAction: null,
      proposalJson: {
        action: 'reconcile',
        reconcileProposal: {
          driftLogId: 'drift_1',
          caseManagementId: 'case_knee',
          fhirConditionId: 'cond_knee',
          driftKind: 'STATUS',
          summary: 's',
          resolutionOptions: [
            { kind: 'reopen-case', label: 'Reopen as recurrence', reasoning: 'r' },
            { kind: 'attach-as-is', label: 'Attach as-is', reasoning: 'r' },
          ],
          recommendedOptionIndex: 0,
        },
        confidence: 'medium',
        reasoning: 'x',
        alternatives: [],
      },
    });

    const tx = {
      ...writebackOffDefaults(),
      caseManagement: {
        findUnique: vi.fn().mockResolvedValueOnce({
          id: 'case_pending_d',
          status: 'PENDING_ROUTER',
        }),
        findFirst: vi.fn().mockResolvedValueOnce({
          id: 'case_knee',
          status: 'CLOSED',
        }),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValueOnce({}),
      },
      encounter: {
        update: vi.fn().mockResolvedValueOnce({}),
      },
      caseRouterRun: {
        update: vi.fn().mockResolvedValueOnce({}),
      },
      caseFhirDriftLog: {
        findFirst: vi.fn().mockResolvedValueOnce({
          id: 'drift_1',
          caseManagementId: 'case_knee',
          resolvedAt: null,
        }),
        update: vi.fn().mockResolvedValueOnce({}),
      },
    };
    txMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const res = await POST(
      buildRequest({
        caseRouterRunId: 'run_d',
        decision: {
          kind: 'reconcile',
          driftLogId: 'drift_1',
          resolution: { kind: 'reopen-case' },
        },
      }),
      { params: Promise.resolve({ id: 'note_drift' }) },
    );
    expect(res.status).toBe(200);
    // Drifted case flipped back to ACTIVE.
    expect(tx.caseManagement.update).toHaveBeenCalledWith({
      where: { id: 'case_knee' },
      data: { status: 'ACTIVE' },
    });
    // Encounter rebound + pending case deleted.
    expect(tx.encounter.update).toHaveBeenCalledWith({
      where: { id: 'enc_d' },
      data: { caseManagementId: 'case_knee' },
    });
    expect(tx.caseManagement.delete).toHaveBeenCalledWith({
      where: { id: 'case_pending_d' },
    });
    // Drift log resolved.
    expect(tx.caseFhirDriftLog.update).toHaveBeenCalledWith({
      where: { id: 'drift_1' },
      data: expect.objectContaining({
        resolvedAction: 'reopen-case',
        resolvedByUserId: 'user_1',
      }),
    });
    // Drift-resolved audit fires with persona version.
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CASE_FHIR_DRIFT_RESOLVED',
        metadata: expect.objectContaining({
          driftLogId: 'drift_1',
          caseManagementId: 'case_knee',
          resolutionKind: 'reopen-case',
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
  });

  it('Sprint 0.16: resolves a STATUS drift with "close-case" — closes drifted case + promotes pending', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_drift',
      orgId: 'org_1',
      patientId: 'pat_drift',
      status: 'DRAFT',
      clinicianOrgUserId: 'ou_1',
      encounterId: 'enc_d',
      encounter: { id: 'enc_d', caseManagementId: 'case_pending_d' },
    });
    caseRouterRunFindFirst.mockResolvedValueOnce({
      id: 'run_d',
      orgId: 'org_1',
      noteId: 'note_drift',
      acceptedAction: null,
      proposalJson: {
        action: 'reconcile',
        reconcileProposal: {
          driftLogId: 'drift_1',
          caseManagementId: 'case_knee',
          fhirConditionId: 'cond_knee',
          driftKind: 'STATUS',
          summary: 's',
          resolutionOptions: [
            { kind: 'close-case', label: 'Close', reasoning: 'r' },
            { kind: 'attach-as-is', label: 'Attach as-is', reasoning: 'r' },
          ],
        },
        confidence: 'medium',
        reasoning: 'x',
        alternatives: [],
      },
    });

    const tx = {
      ...writebackOffDefaults(),
      caseManagement: {
        findUnique: vi.fn().mockResolvedValueOnce({
          id: 'case_pending_d',
          status: 'PENDING_ROUTER',
        }),
        findFirst: vi.fn().mockResolvedValueOnce({
          id: 'case_knee',
          status: 'ACTIVE',
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      caseRouterRun: { update: vi.fn().mockResolvedValueOnce({}) },
      caseFhirDriftLog: {
        findFirst: vi.fn().mockResolvedValueOnce({
          id: 'drift_1',
          caseManagementId: 'case_knee',
          resolvedAt: null,
        }),
        update: vi.fn().mockResolvedValueOnce({}),
      },
    };
    txMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const res = await POST(
      buildRequest({
        caseRouterRunId: 'run_d',
        decision: {
          kind: 'reconcile',
          driftLogId: 'drift_1',
          resolution: { kind: 'close-case', reason: 'EHR resolved 2025-01-12' },
        },
      }),
      { params: Promise.resolve({ id: 'note_drift' }) },
    );
    expect(res.status).toBe(200);
    // Drifted case closed with reason carried through.
    expect(tx.caseManagement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'case_knee' },
        data: expect.objectContaining({
          status: 'CLOSED',
          closeReason: 'EHR resolved 2025-01-12',
        }),
      }),
    );
    // Pending case promoted (post-reconcile placeholder).
    expect(tx.caseManagement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'case_pending_d' },
        data: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CASE_FHIR_DRIFT_RESOLVED',
        metadata: expect.objectContaining({ resolutionKind: 'close-case' }),
      }),
    );
  });

  it('Sprint 0.16: resolves an ICD drift with "update-case-icd" — updates the case ICD + binds + resolves log', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_drift',
      orgId: 'org_1',
      patientId: 'pat_drift',
      status: 'DRAFT',
      clinicianOrgUserId: 'ou_1',
      encounterId: 'enc_d',
      encounter: { id: 'enc_d', caseManagementId: 'case_pending_d' },
    });
    caseRouterRunFindFirst.mockResolvedValueOnce({
      id: 'run_d',
      orgId: 'org_1',
      noteId: 'note_drift',
      acceptedAction: null,
      proposalJson: {
        action: 'reconcile',
        reconcileProposal: {
          driftLogId: 'drift_1',
          caseManagementId: 'case_knee',
          fhirConditionId: 'cond_knee',
          driftKind: 'ICD',
          summary: 's',
          resolutionOptions: [
            { kind: 'update-case-icd', label: 'Update', reasoning: 'r' },
            { kind: 'attach-as-is', label: 'Attach', reasoning: 'r' },
          ],
        },
        confidence: 'medium',
        reasoning: 'x',
        alternatives: [],
      },
    });

    const tx = {
      ...writebackOffDefaults(),
      caseManagement: {
        findUnique: vi.fn().mockResolvedValueOnce({
          id: 'case_pending_d',
          status: 'PENDING_ROUTER',
        }),
        findFirst: vi.fn().mockResolvedValueOnce({
          id: 'case_knee',
          status: 'ACTIVE',
        }),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValueOnce({}),
      },
      encounter: { update: vi.fn().mockResolvedValueOnce({}) },
      caseRouterRun: { update: vi.fn().mockResolvedValueOnce({}) },
      caseFhirDriftLog: {
        findFirst: vi.fn().mockResolvedValueOnce({
          id: 'drift_1',
          caseManagementId: 'case_knee',
          resolvedAt: null,
        }),
        update: vi.fn().mockResolvedValueOnce({}),
      },
    };
    txMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const res = await POST(
      buildRequest({
        caseRouterRunId: 'run_d',
        decision: {
          kind: 'reconcile',
          driftLogId: 'drift_1',
          resolution: {
            kind: 'update-case-icd',
            newIcd: 'M17.12',
            newIcdLabel: 'Left knee OA',
          },
        },
      }),
      { params: Promise.resolve({ id: 'note_drift' }) },
    );
    expect(res.status).toBe(200);
    expect(tx.caseManagement.update).toHaveBeenCalledWith({
      where: { id: 'case_knee' },
      data: { primaryIcd: 'M17.12', primaryIcdLabel: 'Left knee OA' },
    });
    expect(tx.caseFhirDriftLog.update).toHaveBeenCalledWith({
      where: { id: 'drift_1' },
      data: expect.objectContaining({ resolvedAction: 'update-case-icd' }),
    });
  });

  it('Sprint 0.16: 409 when the drift log is already resolved (concurrent review race)', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_drift',
      orgId: 'org_1',
      patientId: 'pat_drift',
      status: 'DRAFT',
      clinicianOrgUserId: 'ou_1',
      encounterId: 'enc_d',
      encounter: { id: 'enc_d', caseManagementId: 'case_pending_d' },
    });
    caseRouterRunFindFirst.mockResolvedValueOnce({
      id: 'run_d',
      orgId: 'org_1',
      noteId: 'note_drift',
      acceptedAction: null,
      proposalJson: {
        action: 'reconcile',
        reconcileProposal: {
          driftLogId: 'drift_done',
          caseManagementId: 'case_knee',
          fhirConditionId: 'cond_knee',
          driftKind: 'STATUS',
          summary: 's',
          resolutionOptions: [
            { kind: 'reopen-case', label: 'a', reasoning: 'r' },
            { kind: 'attach-as-is', label: 'b', reasoning: 'r' },
          ],
        },
        confidence: 'medium',
        reasoning: 'x',
        alternatives: [],
      },
    });

    const tx = {
      ...writebackOffDefaults(),
      caseManagement: {
        findUnique: vi.fn().mockResolvedValueOnce({
          id: 'case_pending_d',
          status: 'PENDING_ROUTER',
        }),
      },
      caseFhirDriftLog: {
        findFirst: vi.fn().mockResolvedValueOnce({
          id: 'drift_done',
          caseManagementId: 'case_knee',
          resolvedAt: new Date('2025-01-15'), // already resolved
        }),
      },
    };
    txMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const res = await POST(
      buildRequest({
        caseRouterRunId: 'run_d',
        decision: {
          kind: 'reconcile',
          driftLogId: 'drift_done',
          resolution: { kind: 'reopen-case' },
        },
      }),
      { params: Promise.resolve({ id: 'note_drift' }) },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('drift_already_resolved');
  });

  // ===========================================================================
  // Sprint 0.17 — FHIR write-back proposal insert (decision 10 gating).
  // ===========================================================================

  it('Sprint 0.17: writebackEnabled=true on open-new with coded ICD → inserts FhirWriteBackProposal + emits FHIR_WRITEBACK_PROPOSED + returns writeBackProposal', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_wb',
      orgId: 'org_1',
      patientId: 'pat_wb',
      status: 'DRAFT',
      clinicianOrgUserId: 'ou_1',
      encounterId: 'enc_wb',
      encounter: { id: 'enc_wb', caseManagementId: 'case_pending_wb' },
    });
    caseRouterRunFindFirst.mockResolvedValueOnce({
      id: 'run_wb',
      orgId: 'org_1',
      noteId: 'note_wb',
      acceptedAction: null,
      proposalJson: {
        action: 'open-new',
        newCase: {
          primaryIcd: 'F33.1',
          primaryIcdLabel: 'Major depressive disorder',
        },
        confidence: 'high',
        reasoning: 'New depression presentation.',
        alternatives: [],
      },
    });

    const tx = {
      ...writebackOffDefaults(),
      caseManagement: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'case_pending_wb', status: 'PENDING_ROUTER' }) // mutation branch entry
          .mockResolvedValueOnce({
            id: 'case_pending_wb',
            primaryIcd: 'F33.1',
            primaryIcdLabel: 'Major depressive disorder',
            status: 'ACTIVE',
            mirrorsFhirConditionId: null,
          }), // write-back gate re-reads post-mutation
        update: vi.fn().mockResolvedValueOnce({}),
      },
      caseRouterRun: { update: vi.fn().mockResolvedValueOnce({}) },
      // Sprint 0.17 — writeback ON for this test, override the default.
      orgEhrConnection: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ writebackEnabled: true }),
      },
      patientFhirIdentity: {
        findFirst: vi.fn().mockResolvedValueOnce({ fhirPatientId: 'fhir-pat-wb' }),
      },
      fhirCachedResource: { findFirst: vi.fn() },
      fhirWriteBackProposal: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: 'wbp_new_1', operation: 'CREATE' }),
      },
    };
    txMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const res = await POST(
      buildRequest({ caseRouterRunId: 'run_wb', decision: { kind: 'accept' } }),
      { params: Promise.resolve({ id: 'note_wb' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.writeBackProposal).toMatchObject({
      id: 'wbp_new_1',
      operation: 'CREATE',
    });
    expect(typeof body.data.writeBackProposal.summary).toBe('string');
    // Proposal inserted with the right shape.
    expect(tx.fhirWriteBackProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orgId: 'org_1',
          caseManagementId: 'case_pending_wb',
          patientId: 'pat_wb',
          proposedByUserId: 'user_1',
          operation: 'CREATE',
          triggerKind: 'open-new',
          status: 'PROPOSED',
        }),
      }),
    );
    // FHIR_WRITEBACK_PROPOSED audit fired with persona version.
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FHIR_WRITEBACK_PROPOSED',
        metadata: expect.objectContaining({
          proposalId: 'wbp_new_1',
          caseManagementId: 'case_pending_wb',
          operation: 'CREATE',
          triggerKind: 'open-new',
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
  });

  it('Sprint 0.17: writebackEnabled=false → no proposal, no FHIR_WRITEBACK_* audit, byte-identical Sprint 0.16 (decision 10)', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_wb_off',
      orgId: 'org_1',
      patientId: 'pat_wb_off',
      status: 'DRAFT',
      clinicianOrgUserId: 'ou_1',
      encounterId: 'enc_wb_off',
      encounter: { id: 'enc_wb_off', caseManagementId: 'case_pending_off' },
    });
    caseRouterRunFindFirst.mockResolvedValueOnce({
      id: 'run_off',
      orgId: 'org_1',
      noteId: 'note_wb_off',
      acceptedAction: null,
      proposalJson: {
        action: 'open-new',
        newCase: { primaryIcd: 'F33.1', primaryIcdLabel: 'Major depressive disorder' },
        confidence: 'high',
        reasoning: 'x',
        alternatives: [],
      },
    });

    const tx = {
      ...writebackOffDefaults(), // writebackEnabled defaults to false
      caseManagement: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'case_pending_off', status: 'PENDING_ROUTER' })
          .mockResolvedValueOnce({
            id: 'case_pending_off',
            primaryIcd: 'F33.1',
            primaryIcdLabel: 'Major depressive disorder',
            status: 'ACTIVE',
            mirrorsFhirConditionId: null,
          }),
        update: vi.fn().mockResolvedValueOnce({}),
      },
      caseRouterRun: { update: vi.fn().mockResolvedValueOnce({}) },
    };
    txMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const res = await POST(
      buildRequest({ caseRouterRunId: 'run_off', decision: { kind: 'accept' } }),
      { params: Promise.resolve({ id: 'note_wb_off' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // The field is NULL — UI hides the inline section.
    expect(body.data.writeBackProposal).toBeNull();
    // No FHIR_WRITEBACK_* audit emissions whatsoever.
    expect(writeAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FHIR_WRITEBACK_PROPOSED' }),
    );
    // CASE_ROUTER_ACCEPTED still fires (sprint 0.13/0.16 behavior).
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CASE_ROUTER_ACCEPTED' }),
    );
  });

  it('Sprint 0.17: attach action with writebackEnabled=true → no proposal (only mutating actions write back)', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_attach',
      orgId: 'org_1',
      patientId: 'pat_attach',
      status: 'DRAFT',
      clinicianOrgUserId: 'ou_1',
      encounterId: 'enc_attach',
      encounter: { id: 'enc_attach', caseManagementId: 'case_pending_attach' },
    });
    caseRouterRunFindFirst.mockResolvedValueOnce({
      id: 'run_attach',
      orgId: 'org_1',
      noteId: 'note_attach',
      acceptedAction: null,
      proposalJson: {
        action: 'attach',
        caseManagementId: 'case_existing',
        confidence: 'high',
        reasoning: 'Continues the active case.',
        alternatives: [],
      },
    });

    const tx = {
      ...writebackOffDefaults(),
      caseManagement: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'case_pending_attach', status: 'PENDING_ROUTER' }),
        findFirst: vi.fn().mockResolvedValueOnce({
          id: 'case_existing',
          status: 'ACTIVE',
          secondaryIcd: null,
          secondaryIcdLabel: null,
        }),
        delete: vi.fn().mockResolvedValueOnce({}),
      },
      encounter: { update: vi.fn().mockResolvedValueOnce({}) },
      caseRouterRun: { update: vi.fn().mockResolvedValueOnce({}) },
      // Even though writebackEnabled is true, attach is non-mutating.
      orgEhrConnection: {
        findFirst: vi.fn().mockResolvedValue({ writebackEnabled: true }),
      },
    };
    txMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const res = await POST(
      buildRequest({ caseRouterRunId: 'run_attach', decision: { kind: 'accept' } }),
      { params: Promise.resolve({ id: 'note_attach' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.writeBackProposal).toBeNull();
    // The write-back gate short-circuits on `attach` BEFORE the org
    // toggle read — so orgEhrConnection.findFirst is never called.
    expect(tx.orgEhrConnection.findFirst).not.toHaveBeenCalled();
  });

  it('Sprint 0.17: reconcile with attach-as-is + writebackEnabled=true → no proposal (decision 9)', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_attach_as_is',
      orgId: 'org_1',
      patientId: 'pat_aai',
      status: 'DRAFT',
      clinicianOrgUserId: 'ou_1',
      encounterId: 'enc_aai',
      encounter: { id: 'enc_aai', caseManagementId: 'case_pending_aai' },
    });
    caseRouterRunFindFirst.mockResolvedValueOnce({
      id: 'run_aai',
      orgId: 'org_1',
      noteId: 'note_attach_as_is',
      acceptedAction: null,
      proposalJson: {
        action: 'reconcile',
        reconcileProposal: {
          driftLogId: 'drift_aai',
          caseManagementId: 'case_knee',
          fhirConditionId: 'cond_knee',
          driftKind: 'STATUS',
          summary: 's',
          resolutionOptions: [
            { kind: 'reopen-case', label: 'a', reasoning: 'r' },
            { kind: 'attach-as-is', label: 'b', reasoning: 'r' },
          ],
        },
        confidence: 'medium',
        reasoning: 'x',
        alternatives: [],
      },
    });

    const tx = {
      ...writebackOffDefaults(),
      caseManagement: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'case_pending_aai', status: 'PENDING_ROUTER' }),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: 'case_knee', status: 'ACTIVE' }),
        delete: vi.fn(),
        update: vi.fn().mockResolvedValueOnce({}),
      },
      encounter: { update: vi.fn().mockResolvedValueOnce({}) },
      caseRouterRun: { update: vi.fn().mockResolvedValueOnce({}) },
      caseFhirDriftLog: {
        findFirst: vi.fn().mockResolvedValueOnce({
          id: 'drift_aai',
          caseManagementId: 'case_knee',
          resolvedAt: null,
        }),
        update: vi.fn().mockResolvedValueOnce({}),
      },
      orgEhrConnection: {
        findFirst: vi.fn().mockResolvedValue({ writebackEnabled: true }),
      },
    };
    txMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

    const res = await POST(
      buildRequest({
        caseRouterRunId: 'run_aai',
        decision: {
          kind: 'reconcile',
          driftLogId: 'drift_aai',
          resolution: { kind: 'attach-as-is' },
        },
      }),
      { params: Promise.resolve({ id: 'note_attach_as_is' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.writeBackProposal).toBeNull();
    expect(writeAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FHIR_WRITEBACK_PROPOSED' }),
    );
  });

  it('refuses to mutate after a SIGNED note (routing locked)', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_signed',
      orgId: 'org_1',
      patientId: 'pat_signed',
      status: 'SIGNED',
      clinicianOrgUserId: 'ou_1',
      encounterId: 'enc_signed',
      encounter: { id: 'enc_signed', caseManagementId: 'case_signed' },
    });
    const res = await POST(
      buildRequest({ caseRouterRunId: 'run_x', decision: { kind: 'accept' } }),
      { params: Promise.resolve({ id: 'note_signed' }) },
    );
    expect(res.status).toBe(409);
  });
});
