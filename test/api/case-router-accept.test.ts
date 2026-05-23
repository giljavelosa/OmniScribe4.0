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
