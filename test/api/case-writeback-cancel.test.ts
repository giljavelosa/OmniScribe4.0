import { describe, expect, it, beforeEach, vi } from 'vitest';

const proposalFindUnique = vi.fn();
const proposalUpdate = vi.fn();
const writeAuditLog = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    fhirWriteBackProposal: {
      findUnique: (...a: unknown[]) => proposalFindUnique(...a),
      update: (...a: unknown[]) => proposalUpdate(...a),
    },
  },
}));
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));
vi.mock('@/lib/queue', () => ({
  enqueueFhirWriteback: vi.fn(),
}));
vi.mock('@/lib/phi-access', () => ({ assertOrgScoped: vi.fn() }));

const requireFeatureAccess = vi.fn();
vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccess(...a),
}));

import { POST } from '@/app/api/cases/[id]/writeback/cancel/route';

function authed() {
  requireFeatureAccess.mockResolvedValueOnce({
    user: { id: 'user_1' },
    authorizationUser: { orgId: 'org_1', orgUserId: 'ou_1', role: 'CLINICIAN' },
    orgUser: { id: 'ou_1', orgId: 'org_1' },
  });
}

function buildReq(body: unknown) {
  return new Request('http://test.local/api/cases/case_1/writeback/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  proposalFindUnique.mockReset();
  proposalUpdate.mockReset();
  writeAuditLog.mockReset();
  requireFeatureAccess.mockReset();
});

describe('POST /api/cases/[id]/writeback/cancel', () => {
  it('cancels a PROPOSED proposal + emits clinician-reason audit', async () => {
    authed();
    proposalFindUnique.mockResolvedValueOnce({
      id: 'wbp_1',
      orgId: 'org_1',
      caseManagementId: 'case_1',
      status: 'PROPOSED',
    });
    proposalUpdate.mockResolvedValueOnce({});
    const res = await POST(
      buildReq({ proposalId: 'wbp_1' }),
      { params: Promise.resolve({ id: 'case_1' }) },
    );
    expect(res.status).toBe(200);
    expect(proposalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelledByUserId: 'user_1',
        }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FHIR_WRITEBACK_CANCELLED',
        metadata: expect.objectContaining({
          cancelReason: 'clinician',
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
  });

  it('cancels a FAILED proposal (post-failure cleanup)', async () => {
    authed();
    proposalFindUnique.mockResolvedValueOnce({
      id: 'wbp_1',
      orgId: 'org_1',
      caseManagementId: 'case_1',
      status: 'FAILED',
    });
    const res = await POST(
      buildReq({ proposalId: 'wbp_1' }),
      { params: Promise.resolve({ id: 'case_1' }) },
    );
    expect(res.status).toBe(200);
  });

  it('idempotent: already CANCELLED → 200 with status, no second audit', async () => {
    authed();
    proposalFindUnique.mockResolvedValueOnce({
      id: 'wbp_1',
      orgId: 'org_1',
      caseManagementId: 'case_1',
      status: 'CANCELLED',
    });
    const res = await POST(
      buildReq({ proposalId: 'wbp_1' }),
      { params: Promise.resolve({ id: 'case_1' }) },
    );
    expect(res.status).toBe(200);
    expect(proposalUpdate).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('409 invalid_state on EXECUTING (let the worker finish)', async () => {
    authed();
    proposalFindUnique.mockResolvedValueOnce({
      id: 'wbp_1',
      orgId: 'org_1',
      caseManagementId: 'case_1',
      status: 'EXECUTING',
    });
    const res = await POST(
      buildReq({ proposalId: 'wbp_1' }),
      { params: Promise.resolve({ id: 'case_1' }) },
    );
    expect(res.status).toBe(409);
  });

  it('409 invalid_state on SUCCEEDED (terminal)', async () => {
    authed();
    proposalFindUnique.mockResolvedValueOnce({
      id: 'wbp_1',
      orgId: 'org_1',
      caseManagementId: 'case_1',
      status: 'SUCCEEDED',
    });
    const res = await POST(
      buildReq({ proposalId: 'wbp_1' }),
      { params: Promise.resolve({ id: 'case_1' }) },
    );
    expect(res.status).toBe(409);
  });
});
