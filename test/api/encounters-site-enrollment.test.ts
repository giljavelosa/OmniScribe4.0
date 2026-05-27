import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * POST /api/encounters site-enrollment enforcement.
 *
 * Mocks auth + prisma + startVisit so we can exercise the new
 * `site_not_enrolled` branch without hitting Postgres. Verifies the route
 * still allows ORG_ADMIN to bypass (scope: 'all') and still falls back to
 * the clinician's single enrollment when no siteId hint is supplied.
 */

const mockAuth = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

const orgUserFindUnique = vi.fn();
const patientFindFirst = vi.fn();
const caseManagementFindFirst = vi.fn();
const siteFindMany = vi.fn();
const orgUserSiteFindMany = vi.fn();
const txFn = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    orgUser: { findUnique: (...a: unknown[]) => orgUserFindUnique(...a) },
    patient: { findFirst: (...a: unknown[]) => patientFindFirst(...a) },
    caseManagement: { findFirst: (...a: unknown[]) => caseManagementFindFirst(...a) },
    site: { findMany: (...a: unknown[]) => siteFindMany(...a) },
    orgUserSite: { findMany: (...a: unknown[]) => orgUserSiteFindMany(...a) },
    $transaction: (cb: (tx: unknown) => unknown) => txFn(cb),
  },
}));

const baseBody = { patientId: 'pat_1', caseManagementId: 'case_1' };

const startVisitMock = vi.fn();
vi.mock('@/lib/encounters/start', () => ({
  startVisit: (...a: unknown[]) => startVisitMock(...a),
}));

vi.mock('@/lib/audit/impersonation', () => ({
  assertNotImpersonating: vi.fn(async () => ({ ok: true })),
}));

// Seat gate: bypass — these tests predate Wave 7 billing and don't test
// seat enforcement. checkClinicianSeat always passes here.
vi.mock('@/lib/authz/seat', () => ({
  checkClinicianSeat: vi.fn(async () => ({ ok: true })),
  seatRequiredResponse: vi.fn(),
}));

import { POST } from '@/app/api/encounters/route';

function session(
  role: 'CLINICIAN' | 'ORG_ADMIN' | 'SITE_ADMIN',
  overrides: Record<string, unknown> = {},
) {
  return {
    user: {
      id: 'u1',
      email: 'u@x.com',
      orgId: 'org_1',
      orgUserId: 'ou_caller',
      role,
      division: 'MEDICAL',
      platformRole: 'NONE',
      canManagePatients: false,
      ...overrides,
    },
  };
}

function buildRequest(body: unknown) {
  return new Request('http://test.local/api/encounters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockAuth.mockReset();
  orgUserFindUnique.mockReset();
  patientFindFirst.mockReset();
  caseManagementFindFirst.mockReset();
  siteFindMany.mockReset();
  orgUserSiteFindMany.mockReset();
  txFn.mockReset();
  startVisitMock.mockReset();
});

describe('POST /api/encounters — multi-site enforcement', () => {
  it('returns 400 site_not_enrolled when a clinician requests a site outside their enrollment', async () => {
    mockAuth.mockResolvedValueOnce(session('CLINICIAN'));
    orgUserFindUnique.mockResolvedValueOnce({
      id: 'ou_caller',
      orgId: 'org_1',
      role: 'CLINICIAN',
      division: 'MEDICAL',
      isActive: true,
      canManagePatients: false,    });
    patientFindFirst.mockResolvedValueOnce({ id: 'pat_1', siteId: 's_off_limits' });
    orgUserFindUnique.mockResolvedValueOnce({ role: 'CLINICIAN', orgId: 'org_1' });
    orgUserSiteFindMany.mockResolvedValueOnce([{ siteId: 's_enrolled' }]);

    const res = await POST(buildRequest({ ...baseBody, siteId: 's_off_limits' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('site_not_enrolled');
    expect(startVisitMock).not.toHaveBeenCalled();
  });

  it('ORG_ADMIN bypasses enrollment check (scope=all)', async () => {
    // ORG_ADMIN has full clinical features (absorbed from removed SUPER_ADMIN)
    // and is the canonical "all-sites bypass" actor — site-scope helpers
    // return scope='all' for ORG_ADMIN without OrgUserSite rows.
    mockAuth.mockResolvedValueOnce(session('ORG_ADMIN'));
    orgUserFindUnique.mockResolvedValueOnce({
      id: 'ou_caller',
      orgId: 'org_1',
      role: 'ORG_ADMIN',
      division: 'MULTI',
      isActive: true,
      canManagePatients: false,    });
    patientFindFirst.mockResolvedValueOnce({ id: 'pat_1', siteId: 's_any' });
    caseManagementFindFirst.mockResolvedValueOnce({ id: 'case_1', status: 'ACTIVE' });
    orgUserFindUnique.mockResolvedValueOnce({ role: 'ORG_ADMIN', orgId: 'org_1' });
    siteFindMany.mockResolvedValueOnce([{ id: 's_any' }, { id: 's_other' }]);
    txFn.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
    startVisitMock.mockResolvedValueOnce({ encounter: { id: 'enc_1' }, note: { id: 'note_1' } });

    const res = await POST(buildRequest({ ...baseBody, siteId: 's_any' }));
    expect(res.status).toBe(200);
    expect(startVisitMock).toHaveBeenCalledOnce();
  });

  it('clinician with exactly one enrollment auto-falls-back when no siteId hint is provided', async () => {
    mockAuth.mockResolvedValueOnce(session('CLINICIAN'));
    orgUserFindUnique.mockResolvedValueOnce({
      id: 'ou_caller',
      orgId: 'org_1',
      role: 'CLINICIAN',
      division: 'MEDICAL',
      isActive: true,
      canManagePatients: false,    });
    patientFindFirst.mockResolvedValueOnce({ id: 'pat_1', siteId: null });
    caseManagementFindFirst.mockResolvedValueOnce({ id: 'case_1', status: 'ACTIVE' });
    orgUserFindUnique.mockResolvedValueOnce({ role: 'CLINICIAN', orgId: 'org_1' });
    orgUserSiteFindMany.mockResolvedValueOnce([{ siteId: 's_only' }]);
    txFn.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
    startVisitMock.mockResolvedValueOnce({ encounter: { id: 'enc_1' }, note: { id: 'note_1' } });

    const res = await POST(buildRequest(baseBody));
    expect(res.status).toBe(200);
    const callArgs = startVisitMock.mock.calls[0]?.[0] as { siteId?: string } | undefined;
    expect(callArgs?.siteId).toBe('s_only');
  });

  it('clinician with zero enrollments AND no siteId hint returns site_required (not site_not_enrolled)', async () => {
    mockAuth.mockResolvedValueOnce(session('CLINICIAN'));
    orgUserFindUnique.mockResolvedValueOnce({
      id: 'ou_caller',
      orgId: 'org_1',
      role: 'CLINICIAN',
      division: 'MEDICAL',
      isActive: true,
      canManagePatients: false,    });
    patientFindFirst.mockResolvedValueOnce({ id: 'pat_1', siteId: null });
    orgUserFindUnique.mockResolvedValueOnce({ role: 'CLINICIAN', orgId: 'org_1' });
    orgUserSiteFindMany.mockResolvedValueOnce([]);

    const res = await POST(buildRequest({ patientId: 'pat_1', caseManagementId: 'case_1' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    // No siteId at all → site_required short-circuit fires before the enrollment check.
    expect(body.error?.code).toBe('site_required');
  });
});
