import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * POST /api/encounters site-enrollment enforcement.
 *
 * Mocks auth + prisma + startVisit so we can exercise the new
 * `site_not_enrolled` branch without hitting Postgres. Verifies the route
 * still allows SUPER_ADMIN to bypass (scope: 'all') and still falls back to
 * the clinician's single enrollment when no siteId hint is supplied.
 */

const mockAuth = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

const orgUserFindUnique = vi.fn();
const patientFindFirst = vi.fn();
const siteFindMany = vi.fn();
const orgUserSiteFindMany = vi.fn();
const txFn = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    orgUser: { findUnique: (...a: unknown[]) => orgUserFindUnique(...a) },
    patient: { findFirst: (...a: unknown[]) => patientFindFirst(...a) },
    site: { findMany: (...a: unknown[]) => siteFindMany(...a) },
    orgUserSite: { findMany: (...a: unknown[]) => orgUserSiteFindMany(...a) },
    $transaction: (cb: (tx: unknown) => unknown) => txFn(cb),
  },
}));

const startVisitMock = vi.fn();
vi.mock('@/lib/encounters/start', () => ({
  startVisit: (...a: unknown[]) => startVisitMock(...a),
}));

vi.mock('@/lib/audit/impersonation', () => ({
  assertNotImpersonating: vi.fn(async () => ({ ok: true })),
}));

import { POST } from '@/app/api/encounters/route';

function session(
  role: 'CLINICIAN' | 'ORG_ADMIN' | 'SITE_ADMIN' | 'SUPER_ADMIN',
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
      mfaEnabled: true,
      mfaVerified: true,
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
      canManagePatients: false,
      organization: { forceMfa: false },
    });
    patientFindFirst.mockResolvedValueOnce({ id: 'pat_1', siteId: 's_off_limits' });
    orgUserFindUnique.mockResolvedValueOnce({ role: 'CLINICIAN', orgId: 'org_1' });
    orgUserSiteFindMany.mockResolvedValueOnce([{ siteId: 's_enrolled' }]);

    const res = await POST(buildRequest({ patientId: 'pat_1', siteId: 's_off_limits' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('site_not_enrolled');
    expect(startVisitMock).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN bypasses enrollment check (scope=all)', async () => {
    // ORG_ADMIN doesn't have VISITS_CREATE in the feature matrix, so
    // SUPER_ADMIN is the canonical "all-sites bypass" actor under the spec's
    // "ORG_ADMIN+ bypass" rule.
    mockAuth.mockResolvedValueOnce(session('SUPER_ADMIN'));
    orgUserFindUnique.mockResolvedValueOnce({
      id: 'ou_caller',
      orgId: 'org_1',
      role: 'SUPER_ADMIN',
      division: 'MULTI',
      isActive: true,
      canManagePatients: false,
      organization: { forceMfa: false },
    });
    patientFindFirst.mockResolvedValueOnce({ id: 'pat_1', siteId: 's_any' });
    orgUserFindUnique.mockResolvedValueOnce({ role: 'SUPER_ADMIN', orgId: 'org_1' });
    siteFindMany.mockResolvedValueOnce([{ id: 's_any' }, { id: 's_other' }]);
    txFn.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
    startVisitMock.mockResolvedValueOnce({ encounter: { id: 'enc_1' }, note: { id: 'note_1' } });

    const res = await POST(buildRequest({ patientId: 'pat_1', siteId: 's_any' }));
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
      canManagePatients: false,
      organization: { forceMfa: false },
    });
    patientFindFirst.mockResolvedValueOnce({ id: 'pat_1', siteId: null });
    orgUserFindUnique.mockResolvedValueOnce({ role: 'CLINICIAN', orgId: 'org_1' });
    orgUserSiteFindMany.mockResolvedValueOnce([{ siteId: 's_only' }]);
    txFn.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
    startVisitMock.mockResolvedValueOnce({ encounter: { id: 'enc_1' }, note: { id: 'note_1' } });

    const res = await POST(buildRequest({ patientId: 'pat_1' }));
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
      canManagePatients: false,
      organization: { forceMfa: false },
    });
    patientFindFirst.mockResolvedValueOnce({ id: 'pat_1', siteId: null });
    orgUserFindUnique.mockResolvedValueOnce({ role: 'CLINICIAN', orgId: 'org_1' });
    orgUserSiteFindMany.mockResolvedValueOnce([]);

    const res = await POST(buildRequest({ patientId: 'pat_1' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    // No siteId at all → site_required short-circuit fires before the enrollment check.
    expect(body.error?.code).toBe('site_required');
  });
});
