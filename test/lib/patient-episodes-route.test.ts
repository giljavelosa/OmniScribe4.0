import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * POST /api/patients/[id]/episodes — validation + happy path tests.
 *
 * The route delegates the authorization gate to requireFeatureAccess and
 * writes through prisma + the audit log. Both are mocked so we can drive
 * the route through its branches without a database.
 */

const patientFindFirst = vi.fn();
const departmentFindFirst = vi.fn();
const episodeOfCareCreate = vi.fn();
const auditLogCreate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    patient: { findFirst: (...a: unknown[]) => patientFindFirst(...a) },
    department: { findFirst: (...a: unknown[]) => departmentFindFirst(...a) },
    episodeOfCare: { create: (...a: unknown[]) => episodeOfCareCreate(...a) },
    auditLog: { create: (...a: unknown[]) => auditLogCreate(...a) },
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

const assertOrgScoped = vi.fn();
vi.mock('@/lib/phi-access', () => ({
  assertOrgScoped: (...a: unknown[]) => assertOrgScoped(...a),
}));

import { POST } from '@/app/api/patients/[id]/episodes/route';

beforeEach(() => {
  patientFindFirst.mockReset();
  departmentFindFirst.mockReset();
  episodeOfCareCreate.mockReset();
  auditLogCreate.mockReset();
  writeAuditLog.mockReset();
  assertOrgScoped.mockReset();
  requireFeatureAccess.mockReset();
});

function authedGuard(overrides: Partial<{ orgId: string; orgUserId: string; userId: string }> = {}) {
  return {
    user: { id: overrides.userId ?? 'user_1' },
    orgUser: {},
    authorizationUser: {
      userId: overrides.userId ?? 'user_1',
      orgUserId: overrides.orgUserId ?? 'ou_1',
      orgId: overrides.orgId ?? 'org_1',
      role: 'CLINICIAN',
      division: 'MULTI',
      platformRole: 'NONE',
      canManagePatients: true,
    },
  };
}

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/patients/pat_1/episodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const paramsFor = (id = 'pat_1') => Promise.resolve({ id });

describe('POST /api/patients/[id]/episodes', () => {
  it('400s on missing diagnosis / division / departmentId', async () => {
    requireFeatureAccess.mockResolvedValueOnce(authedGuard());
    const res = await POST(makeReq({ bodyPart: 'Knee' }), { params: paramsFor() });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('bad_request');
    expect(patientFindFirst).not.toHaveBeenCalled();
  });

  it('returns the guard error response when requireFeatureAccess fails', async () => {
    const errResponse = new Response('forbidden', { status: 403 });
    requireFeatureAccess.mockResolvedValueOnce({ error: errResponse });
    const res = await POST(
      makeReq({ diagnosis: 'd', division: 'REHAB', departmentId: 'dept' }),
      { params: paramsFor() },
    );
    expect(res).toBe(errResponse);
    expect(patientFindFirst).not.toHaveBeenCalled();
  });

  it('404s when the patient is not found in the org', async () => {
    requireFeatureAccess.mockResolvedValueOnce(authedGuard());
    patientFindFirst.mockResolvedValueOnce(null);
    const res = await POST(
      makeReq({ diagnosis: 'd', division: 'REHAB', departmentId: 'dept' }),
      { params: paramsFor() },
    );
    expect(res.status).toBe(404);
  });

  it('400s with department_not_found when the department is missing or wrong org', async () => {
    requireFeatureAccess.mockResolvedValueOnce(authedGuard());
    patientFindFirst.mockResolvedValueOnce({ id: 'pat_1', orgId: 'org_1' });
    departmentFindFirst.mockResolvedValueOnce(null);

    const res = await POST(
      makeReq({ diagnosis: 'd', division: 'REHAB', departmentId: 'missing' }),
      { params: paramsFor() },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('department_not_found');
  });

  it('400s with department_division_mismatch when REHAB episode tries to land in a BH dept', async () => {
    requireFeatureAccess.mockResolvedValueOnce(authedGuard());
    patientFindFirst.mockResolvedValueOnce({ id: 'pat_1', orgId: 'org_1' });
    departmentFindFirst.mockResolvedValueOnce({
      id: 'dept_bh',
      orgId: 'org_1',
      division: 'BEHAVIORAL_HEALTH',
    });

    const res = await POST(
      makeReq({ diagnosis: 'Right knee OA', division: 'REHAB', departmentId: 'dept_bh' }),
      { params: paramsFor() },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('department_division_mismatch');
    expect(episodeOfCareCreate).not.toHaveBeenCalled();
  });

  it('allows a MULTI department to host any division', async () => {
    requireFeatureAccess.mockResolvedValueOnce(authedGuard());
    patientFindFirst.mockResolvedValueOnce({ id: 'pat_1', orgId: 'org_1' });
    departmentFindFirst.mockResolvedValueOnce({
      id: 'dept_multi',
      orgId: 'org_1',
      division: 'MULTI',
    });
    episodeOfCareCreate.mockResolvedValueOnce({
      id: 'ep_new',
      diagnosis: 'BH episode',
      bodyPart: null,
      division: 'BEHAVIORAL_HEALTH',
      status: 'ACTIVE',
      departmentId: 'dept_multi',
      startedAt: new Date('2026-05-18T00:00:00Z'),
    });

    const res = await POST(
      makeReq({ diagnosis: 'BH episode', division: 'BEHAVIORAL_HEALTH', departmentId: 'dept_multi' }),
      { params: paramsFor() },
    );
    expect(res.status).toBe(200);
    expect(episodeOfCareCreate).toHaveBeenCalledOnce();
  });

  it('creates the episode, writes the EPISODE_CREATED audit row, and returns the projection', async () => {
    requireFeatureAccess.mockResolvedValueOnce(authedGuard());
    patientFindFirst.mockResolvedValueOnce({ id: 'pat_1', orgId: 'org_1' });
    departmentFindFirst.mockResolvedValueOnce({
      id: 'dept_rehab',
      orgId: 'org_1',
      division: 'REHAB',
    });
    episodeOfCareCreate.mockResolvedValueOnce({
      id: 'ep_new',
      diagnosis: 'Right knee OA, post-op month 2',
      bodyPart: 'Right knee',
      division: 'REHAB',
      status: 'ACTIVE',
      departmentId: 'dept_rehab',
      startedAt: new Date('2026-05-18T00:00:00Z'),
    });

    const res = await POST(
      makeReq({
        diagnosis: 'Right knee OA, post-op month 2',
        bodyPart: 'Right knee',
        division: 'REHAB',
        departmentId: 'dept_rehab',
      }),
      { params: paramsFor() },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      id: 'ep_new',
      diagnosis: 'Right knee OA, post-op month 2',
      bodyPart: 'Right knee',
      division: 'REHAB',
      status: 'ACTIVE',
      departmentId: 'dept_rehab',
    });

    // Episode create call shape
    const createArg = episodeOfCareCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(createArg.data).toMatchObject({
      orgId: 'org_1',
      patientId: 'pat_1',
      clinicianOrgUserId: 'ou_1',
      departmentId: 'dept_rehab',
      division: 'REHAB',
      diagnosis: 'Right knee OA, post-op month 2',
      bodyPart: 'Right knee',
      status: 'ACTIVE',
    });

    // Audit row shape
    expect(writeAuditLog).toHaveBeenCalledOnce();
    const auditArg = writeAuditLog.mock.calls[0]![0] as Record<string, unknown>;
    expect(auditArg).toMatchObject({
      userId: 'user_1',
      orgId: 'org_1',
      action: 'EPISODE_CREATED',
      resourceType: 'EpisodeOfCare',
      resourceId: 'ep_new',
    });
    expect(auditArg.metadata).toMatchObject({
      patientId: 'pat_1',
      division: 'REHAB',
      departmentId: 'dept_rehab',
      hasBodyPart: true,
    });
  });

  it('records hasBodyPart=false when bodyPart is omitted', async () => {
    requireFeatureAccess.mockResolvedValueOnce(authedGuard());
    patientFindFirst.mockResolvedValueOnce({ id: 'pat_1', orgId: 'org_1' });
    departmentFindFirst.mockResolvedValueOnce({
      id: 'dept_med',
      orgId: 'org_1',
      division: 'MEDICAL',
    });
    episodeOfCareCreate.mockResolvedValueOnce({
      id: 'ep_new',
      diagnosis: 'Hypertension',
      bodyPart: null,
      division: 'MEDICAL',
      status: 'ACTIVE',
      departmentId: 'dept_med',
      startedAt: new Date('2026-05-18T00:00:00Z'),
    });

    await POST(
      makeReq({ diagnosis: 'Hypertension', division: 'MEDICAL', departmentId: 'dept_med' }),
      { params: paramsFor() },
    );
    expect(writeAuditLog).toHaveBeenCalledOnce();
    const metadata = (writeAuditLog.mock.calls[0]![0] as { metadata: Record<string, unknown> }).metadata;
    expect(metadata.hasBodyPart).toBe(false);
  });
});
