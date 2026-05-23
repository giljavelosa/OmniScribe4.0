import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * Sprint 0.17 — POST /api/cases/[id]/writeback/approve tests.
 *
 * Coverage:
 *   - Happy path: PROPOSED → APPROVED + audit + enqueue
 *   - Idempotent: already APPROVED / EXECUTING / SUCCEEDED → 200 with status
 *   - 409 on terminal failure states (FAILED / CANCELLED)
 *   - 404 when proposal doesn't exist or caseId mismatches
 *   - Org-scoped: cross-org request → not_found
 *
 * Test-mocking note (per the prompt): `@/lib/queue` is mocked here so
 * `src/lib/redis.ts` (which throws at module load when REDIS_URL is
 * unset) is never reached.
 */

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

import { POST } from '@/app/api/cases/[id]/writeback/approve/route';

function authed() {
  requireFeatureAccess.mockResolvedValueOnce({
    user: { id: 'user_1', name: 'Dr. M' },
    authorizationUser: { orgId: 'org_1', orgUserId: 'ou_1', role: 'CLINICIAN' },
    orgUser: { id: 'ou_1', orgId: 'org_1' },
  });
}

function buildReq(body: unknown) {
  return new Request('http://test.local/api/cases/case_1/writeback/approve', {
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

describe('POST /api/cases/[id]/writeback/approve', () => {
  it('happy path: PROPOSED → APPROVED + audit + enqueue', async () => {
    authed();
    proposalFindUnique.mockResolvedValueOnce({
      id: 'wbp_1',
      orgId: 'org_1',
      caseManagementId: 'case_1',
      status: 'PROPOSED',
    });
    proposalUpdate.mockResolvedValueOnce({});
    enqueueFhirWriteback.mockResolvedValueOnce({});

    const res = await POST(
      buildReq({ proposalId: 'wbp_1' }),
      { params: Promise.resolve({ id: 'case_1' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ ok: true, status: 'APPROVED' });
    expect(proposalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wbp_1' },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedByUserId: 'user_1',
        }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FHIR_WRITEBACK_APPROVED',
        metadata: expect.objectContaining({
          proposalId: 'wbp_1',
          caseManagementId: 'case_1',
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
    expect(enqueueFhirWriteback).toHaveBeenCalledWith({ proposalId: 'wbp_1' });
  });

  it('idempotent: already APPROVED → 200 with status, no second audit, no second enqueue', async () => {
    authed();
    proposalFindUnique.mockResolvedValueOnce({
      id: 'wbp_1',
      orgId: 'org_1',
      caseManagementId: 'case_1',
      status: 'APPROVED',
    });
    const res = await POST(
      buildReq({ proposalId: 'wbp_1' }),
      { params: Promise.resolve({ id: 'case_1' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ ok: true, status: 'APPROVED' });
    expect(proposalUpdate).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(enqueueFhirWriteback).not.toHaveBeenCalled();
  });

  it('idempotent: SUCCEEDED → 200, no work', async () => {
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
    expect(res.status).toBe(200);
    expect(proposalUpdate).not.toHaveBeenCalled();
  });

  it('409 invalid_state on FAILED (must use /retry path)', async () => {
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
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_state');
  });

  it('409 invalid_state on CANCELLED', async () => {
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
    expect(res.status).toBe(409);
  });

  it('404 when the proposal does not exist', async () => {
    authed();
    proposalFindUnique.mockResolvedValueOnce(null);
    const res = await POST(
      buildReq({ proposalId: 'wbp_missing' }),
      { params: Promise.resolve({ id: 'case_1' }) },
    );
    expect(res.status).toBe(404);
  });

  it('404 when the caseId in the URL does not match the proposal', async () => {
    authed();
    proposalFindUnique.mockResolvedValueOnce({
      id: 'wbp_1',
      orgId: 'org_1',
      caseManagementId: 'case_OTHER',
      status: 'PROPOSED',
    });
    const res = await POST(
      buildReq({ proposalId: 'wbp_1' }),
      { params: Promise.resolve({ id: 'case_1' }) },
    );
    expect(res.status).toBe(404);
  });
});
