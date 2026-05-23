import { describe, expect, it, beforeEach, vi } from 'vitest';

const proposalFindUnique = vi.fn();
const proposalUpdate = vi.fn();
const writeAuditLog = vi.fn();
const enqueueFhirWriteback = vi.fn();

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
  enqueueFhirWriteback: (...a: unknown[]) => enqueueFhirWriteback(...a),
}));
vi.mock('@/lib/phi-access', () => ({ assertOrgScoped: vi.fn() }));

const requireFeatureAccess = vi.fn();
vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccess(...a),
}));

import { POST } from '@/app/api/cases/[id]/writeback/retry/route';

function authed() {
  requireFeatureAccess.mockResolvedValueOnce({
    user: { id: 'user_1' },
    authorizationUser: { orgId: 'org_1', orgUserId: 'ou_1', role: 'CLINICIAN' },
    orgUser: { id: 'ou_1', orgId: 'org_1' },
  });
}

function buildReq(body: unknown) {
  return new Request('http://test.local/api/cases/case_1/writeback/retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  proposalFindUnique.mockReset();
  proposalUpdate.mockReset();
  writeAuditLog.mockReset();
  enqueueFhirWriteback.mockReset();
  requireFeatureAccess.mockReset();
});

describe('POST /api/cases/[id]/writeback/retry', () => {
  it('retries a FAILED + TRANSIENT proposal → APPROVED + audit (retry: true) + enqueue', async () => {
    authed();
    proposalFindUnique.mockResolvedValueOnce({
      id: 'wbp_1',
      orgId: 'org_1',
      caseManagementId: 'case_1',
      status: 'FAILED',
      failureKind: 'TRANSIENT',
    });
    proposalUpdate.mockResolvedValueOnce({});
    enqueueFhirWriteback.mockResolvedValueOnce({});

    const res = await POST(
      buildReq({ proposalId: 'wbp_1' }),
      { params: Promise.resolve({ id: 'case_1' }) },
    );
    expect(res.status).toBe(200);
    expect(proposalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'APPROVED' }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FHIR_WRITEBACK_APPROVED',
        metadata: expect.objectContaining({
          retry: true,
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
    expect(enqueueFhirWriteback).toHaveBeenCalledWith({ proposalId: 'wbp_1' });
  });

  it('409 not_retryable on FAILED + PERMANENT (must propose afresh)', async () => {
    authed();
    proposalFindUnique.mockResolvedValueOnce({
      id: 'wbp_1',
      orgId: 'org_1',
      caseManagementId: 'case_1',
      status: 'FAILED',
      failureKind: 'PERMANENT',
    });
    const res = await POST(
      buildReq({ proposalId: 'wbp_1' }),
      { params: Promise.resolve({ id: 'case_1' }) },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('not_retryable');
    expect(body.error.failureKind).toBe('PERMANENT');
  });

  it('409 not_retryable on FAILED + CONFLICT', async () => {
    authed();
    proposalFindUnique.mockResolvedValueOnce({
      id: 'wbp_1',
      orgId: 'org_1',
      caseManagementId: 'case_1',
      status: 'FAILED',
      failureKind: 'CONFLICT',
    });
    const res = await POST(
      buildReq({ proposalId: 'wbp_1' }),
      { params: Promise.resolve({ id: 'case_1' }) },
    );
    expect(res.status).toBe(409);
    expect(enqueueFhirWriteback).not.toHaveBeenCalled();
  });

  it('409 invalid_state on PROPOSED (use /approve, not /retry)', async () => {
    authed();
    proposalFindUnique.mockResolvedValueOnce({
      id: 'wbp_1',
      orgId: 'org_1',
      caseManagementId: 'case_1',
      status: 'PROPOSED',
      failureKind: null,
    });
    const res = await POST(
      buildReq({ proposalId: 'wbp_1' }),
      { params: Promise.resolve({ id: 'case_1' }) },
    );
    expect(res.status).toBe(409);
  });

  it('404 when proposal does not exist', async () => {
    authed();
    proposalFindUnique.mockResolvedValueOnce(null);
    const res = await POST(
      buildReq({ proposalId: 'wbp_missing' }),
      { params: Promise.resolve({ id: 'case_1' }) },
    );
    expect(res.status).toBe(404);
  });
});
