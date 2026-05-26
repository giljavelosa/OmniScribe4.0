import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * POST /api/admin/users/[id]/sites — validation + audit-write surface.
 *
 * Confirms:
 *   - bad input → 400 bad_request
 *   - primary not in siteIds → 400 primary_not_in_set
 *   - siteIds containing a different org's site → 400 invalid_site
 *   - happy path → 200, deletes existing rows, recreates, writes audit
 */

const mockAuth = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

const orgUserFindUnique = vi.fn();
const orgUserFindFirst = vi.fn();
const siteFindMany = vi.fn();
const orgUserSiteFindMany = vi.fn();
const orgUserSiteDeleteMany = vi.fn();
const orgUserSiteCreateMany = vi.fn();
const txFn = vi.fn();
const auditCreate = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    orgUser: {
      findUnique: (...a: unknown[]) => orgUserFindUnique(...a),
      findFirst: (...a: unknown[]) => orgUserFindFirst(...a),
    },
    site: { findMany: (...a: unknown[]) => siteFindMany(...a) },
    orgUserSite: {
      findMany: (...a: unknown[]) => orgUserSiteFindMany(...a),
      deleteMany: (...a: unknown[]) => orgUserSiteDeleteMany(...a),
      createMany: (...a: unknown[]) => orgUserSiteCreateMany(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
    $transaction: (cb: (tx: unknown) => unknown) => txFn(cb),
  },
}));

vi.mock('@/lib/audit/impersonation', () => ({
  assertNotImpersonating: vi.fn(async () => ({ ok: true })),
}));

import { POST } from '@/app/api/admin/users/[id]/sites/route';

function session() {
  return {
    user: {
      id: 'u_admin',
      email: 'admin@x.com',
      orgId: 'org_1',
      orgUserId: 'ou_admin',
      role: 'ORG_ADMIN',
      division: 'MULTI',
      platformRole: 'NONE',
      canManagePatients: false,
    },
  };
}

function buildRequest(body: unknown) {
  return new Request('http://test.local/api/admin/users/u_target/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockAuth.mockReset();
  orgUserFindUnique.mockReset();
  orgUserFindFirst.mockReset();
  siteFindMany.mockReset();
  orgUserSiteFindMany.mockReset();
  orgUserSiteDeleteMany.mockReset();
  orgUserSiteCreateMany.mockReset();
  txFn.mockReset();
  auditCreate.mockReset();
});

describe('POST /api/admin/users/[id]/sites', () => {
  it('returns 400 bad_request on malformed body', async () => {
    mockAuth.mockResolvedValueOnce(session());
    orgUserFindUnique.mockResolvedValueOnce({
      id: 'ou_admin',
      orgId: 'org_1',
      role: 'ORG_ADMIN',
      division: 'MULTI',
      isActive: true,
      canManagePatients: false,
      organization: { forceMfa: false },
    });

    const res = await POST(buildRequest({ wrongField: true }), {
      params: Promise.resolve({ id: 'u_target' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('bad_request');
  });

  it('returns 400 primary_not_in_set when primary is missing from siteIds', async () => {
    mockAuth.mockResolvedValueOnce(session());
    orgUserFindUnique.mockResolvedValueOnce({
      id: 'ou_admin',
      orgId: 'org_1',
      role: 'ORG_ADMIN',
      division: 'MULTI',
      isActive: true,
      canManagePatients: false,
      organization: { forceMfa: false },
    });

    const res = await POST(buildRequest({ siteIds: ['s1', 's2'], primarySiteId: 's_other' }), {
      params: Promise.resolve({ id: 'u_target' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('primary_not_in_set');
  });

  it('returns 400 invalid_site when a siteId is not in the caller’s org', async () => {
    mockAuth.mockResolvedValueOnce(session());
    orgUserFindUnique.mockResolvedValueOnce({
      id: 'ou_admin',
      orgId: 'org_1',
      role: 'ORG_ADMIN',
      division: 'MULTI',
      isActive: true,
      canManagePatients: false,
      organization: { forceMfa: false },
    });
    orgUserFindFirst.mockResolvedValueOnce({ id: 'ou_target', role: 'CLINICIAN' });
    siteFindMany.mockResolvedValueOnce([{ id: 's1' }]); // only 1 of 2 belongs to org

    const res = await POST(buildRequest({ siteIds: ['s1', 's_foreign'] }), {
      params: Promise.resolve({ id: 'u_target' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('invalid_site');
  });

  it('happy path: deletes existing rows, recreates, writes CLINICIAN_SITES_UPDATED audit', async () => {
    mockAuth.mockResolvedValueOnce(session());
    orgUserFindUnique.mockResolvedValueOnce({
      id: 'ou_admin',
      orgId: 'org_1',
      role: 'ORG_ADMIN',
      division: 'MULTI',
      isActive: true,
      canManagePatients: false,
      organization: { forceMfa: false },
    });
    orgUserFindFirst.mockResolvedValueOnce({ id: 'ou_target', role: 'CLINICIAN' });
    siteFindMany.mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }]);

    txFn.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        orgUserSite: {
          findMany: () => Promise.resolve([{ siteId: 's_old', isPrimary: true }]),
          deleteMany: (...a: unknown[]) => orgUserSiteDeleteMany(...a),
          createMany: (...a: unknown[]) => orgUserSiteCreateMany(...a),
        },
        auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
      };
      return cb(tx);
    });

    const res = await POST(buildRequest({ siteIds: ['s1', 's2'], primarySiteId: 's1' }), {
      params: Promise.resolve({ id: 'u_target' }),
    });
    expect(res.status).toBe(200);
    expect(orgUserSiteDeleteMany).toHaveBeenCalledWith({ where: { orgUserId: 'ou_target' } });
    expect(orgUserSiteCreateMany).toHaveBeenCalledOnce();
    const createArgs = orgUserSiteCreateMany.mock.calls[0]?.[0] as {
      data: Array<{ siteId: string; isPrimary: boolean }>;
    };
    expect(createArgs.data).toEqual([
      expect.objectContaining({ siteId: 's1', isPrimary: true }),
      expect.objectContaining({ siteId: 's2', isPrimary: false }),
    ]);
    expect(auditCreate).toHaveBeenCalledOnce();
    const auditArgs = auditCreate.mock.calls[0]?.[0] as {
      data: { action: string; metadata: { before: string[]; after: string[]; primary: string | null } };
    };
    expect(auditArgs.data.action).toBe('CLINICIAN_SITES_UPDATED');
    expect(auditArgs.data.metadata.after).toEqual(['s1', 's2']);
    expect(auditArgs.data.metadata.before).toEqual(['s_old']);
    expect(auditArgs.data.metadata.primary).toBe('s1');
  });
});
