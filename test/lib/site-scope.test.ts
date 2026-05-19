import { describe, it, expect, vi, beforeEach } from 'vitest';

const orgUserFindUnique = vi.fn();
const siteFindMany = vi.fn();
const orgUserSiteFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    orgUser: { findUnique: (...args: unknown[]) => orgUserFindUnique(...args) },
    site: { findMany: (...args: unknown[]) => siteFindMany(...args) },
    orgUserSite: { findMany: (...args: unknown[]) => orgUserSiteFindMany(...args) },
  },
}));

import {
  getClinicianSiteIds,
  canActAtSite,
  isAllSitesRole,
} from '@/lib/authz/site-scope';

beforeEach(() => {
  orgUserFindUnique.mockReset();
  siteFindMany.mockReset();
  orgUserSiteFindMany.mockReset();
});

describe('isAllSitesRole', () => {
  it('returns true for ORG_ADMIN only', () => {
    expect(isAllSitesRole('ORG_ADMIN')).toBe(true);
    expect(isAllSitesRole('CLINICIAN')).toBe(false);
  });
  it('returns false for SITE_ADMIN, CLINICIAN, VIEWER', () => {
    expect(isAllSitesRole('SITE_ADMIN')).toBe(false);
    expect(isAllSitesRole('CLINICIAN')).toBe(false);
    expect(isAllSitesRole('VIEWER')).toBe(false);
  });
});

describe('getClinicianSiteIds — all-vs-enrolled scope', () => {
  it('ORG_ADMIN gets scope=all with every non-archived org site', async () => {
    orgUserFindUnique.mockResolvedValueOnce({ role: 'ORG_ADMIN', orgId: 'org_1' });
    siteFindMany.mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }, { id: 's3' }]);

    const scope = await getClinicianSiteIds('ou_admin', 'org_1');
    expect(scope.scope).toBe('all');
    expect(scope.siteIds).toEqual(['s1', 's2', 's3']);
    expect(orgUserSiteFindMany).not.toHaveBeenCalled();
    expect(siteFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { orgId: 'org_1', isArchived: false },
    });
  });

  it('CLINICIAN gets scope=enrolled with their OrgUserSite list', async () => {
    orgUserFindUnique.mockResolvedValueOnce({ role: 'CLINICIAN', orgId: 'org_1' });
    orgUserSiteFindMany.mockResolvedValueOnce([{ siteId: 's2' }, { siteId: 's5' }]);

    const scope = await getClinicianSiteIds('ou_clin', 'org_1');
    expect(scope.scope).toBe('enrolled');
    expect(scope.siteIds).toEqual(['s2', 's5']);
    expect(siteFindMany).not.toHaveBeenCalled();
  });

  it('SITE_ADMIN is treated as enrolled scope (not all-sites)', async () => {
    orgUserFindUnique.mockResolvedValueOnce({ role: 'SITE_ADMIN', orgId: 'org_1' });
    orgUserSiteFindMany.mockResolvedValueOnce([{ siteId: 's3' }]);

    const scope = await getClinicianSiteIds('ou_sa', 'org_1');
    expect(scope.scope).toBe('enrolled');
    expect(scope.siteIds).toEqual(['s3']);
  });

  it('clinician with zero enrollments returns empty enrolled scope', async () => {
    orgUserFindUnique.mockResolvedValueOnce({ role: 'CLINICIAN', orgId: 'org_1' });
    orgUserSiteFindMany.mockResolvedValueOnce([]);

    const scope = await getClinicianSiteIds('ou_clin', 'org_1');
    expect(scope.scope).toBe('enrolled');
    expect(scope.siteIds).toEqual([]);
  });

  it('returns empty enrolled scope if the OrgUser does not match the claimed org (defense in depth)', async () => {
    orgUserFindUnique.mockResolvedValueOnce({ role: 'CLINICIAN', orgId: 'OTHER_ORG' });

    const scope = await getClinicianSiteIds('ou_clin', 'org_1');
    expect(scope.scope).toBe('enrolled');
    expect(scope.siteIds).toEqual([]);
    expect(siteFindMany).not.toHaveBeenCalled();
    expect(orgUserSiteFindMany).not.toHaveBeenCalled();
  });

  it('returns empty enrolled scope when the OrgUser row is missing', async () => {
    orgUserFindUnique.mockResolvedValueOnce(null);

    const scope = await getClinicianSiteIds('missing', 'org_1');
    expect(scope.scope).toBe('enrolled');
    expect(scope.siteIds).toEqual([]);
  });
});

describe('canActAtSite', () => {
  it('always true for scope=all', () => {
    expect(canActAtSite({ scope: 'all', siteIds: [] }, 'any_site')).toBe(true);
    expect(canActAtSite({ scope: 'all', siteIds: ['x'] }, 'y')).toBe(true);
  });

  it('checks membership for scope=enrolled', () => {
    const scope = { scope: 'enrolled' as const, siteIds: ['s1', 's2'] };
    expect(canActAtSite(scope, 's1')).toBe(true);
    expect(canActAtSite(scope, 's3')).toBe(false);
  });

  it('clinician with zero enrollments is rejected everywhere', () => {
    const scope = { scope: 'enrolled' as const, siteIds: [] };
    expect(canActAtSite(scope, 'any')).toBe(false);
  });
});
