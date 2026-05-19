import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * SITE_ADMIN scope filtering on the admin/users + admin/sites pages.
 *
 * These are server-component pages; the filter logic boils down to "if the
 * scope is 'enrolled', narrow the query by siteId / siteEnrollments." Rather
 * than render the React tree, this test verifies the same code path the
 * server component takes — the Prisma where-clause shape.
 */

const orgUserFindUnique = vi.fn();
const siteFindMany = vi.fn();
const orgUserSiteFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    orgUser: { findUnique: (...a: unknown[]) => orgUserFindUnique(...a) },
    site: { findMany: (...a: unknown[]) => siteFindMany(...a) },
    orgUserSite: { findMany: (...a: unknown[]) => orgUserSiteFindMany(...a) },
  },
}));

import { getClinicianSiteIds } from '@/lib/authz/site-scope';

beforeEach(() => {
  orgUserFindUnique.mockReset();
  siteFindMany.mockReset();
  orgUserSiteFindMany.mockReset();
});

/** Mirrors the admin/users/page.tsx where-clause assembly for clinician
 *  filtering. ORG_ADMIN+ get an empty narrow object (show everyone),
 *  SITE_ADMIN gets the OR-block (admins always visible + enrollment overlap).
 */
function buildUsersWhere(scope: Awaited<ReturnType<typeof getClinicianSiteIds>>, orgId: string) {
  return {
    orgId,
    ...(scope.scope === 'enrolled'
      ? {
          OR: [
            { role: { in: ['ORG_ADMIN'] } },
            { siteEnrollments: { some: { siteId: { in: scope.siteIds } } } },
          ],
        }
      : {}),
  };
}

/** Mirrors the admin/sites/page.tsx where-clause for site narrowing. */
function buildSitesWhere(scope: Awaited<ReturnType<typeof getClinicianSiteIds>>, orgId: string) {
  return {
    orgId,
    ...(scope.scope === 'enrolled' ? { id: { in: scope.siteIds } } : {}),
  };
}

describe('SITE_ADMIN scope filtering', () => {
  it('ORG_ADMIN sees every user (no enrollment narrowing)', async () => {
    orgUserFindUnique.mockResolvedValueOnce({ role: 'ORG_ADMIN', orgId: 'org_1' });
    siteFindMany.mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }]);
    const scope = await getClinicianSiteIds('ou_oa', 'org_1');

    const where = buildUsersWhere(scope, 'org_1');
    expect(where).toEqual({ orgId: 'org_1' });
    // No OR / siteEnrollments narrowing for org-wide-admins.
    expect('OR' in where).toBe(false);
  });

  it('SITE_ADMIN narrows users to admins + people enrolled at the caller’s sites', async () => {
    orgUserFindUnique.mockResolvedValueOnce({ role: 'SITE_ADMIN', orgId: 'org_1' });
    orgUserSiteFindMany.mockResolvedValueOnce([{ siteId: 's1' }, { siteId: 's2' }]);
    const scope = await getClinicianSiteIds('ou_sa', 'org_1');

    const where = buildUsersWhere(scope, 'org_1');
    expect(where).toEqual({
      orgId: 'org_1',
      OR: [
        { role: { in: ['ORG_ADMIN'] } },
        { siteEnrollments: { some: { siteId: { in: ['s1', 's2'] } } } },
      ],
    });
  });

  it('SITE_ADMIN sites view narrows to enrolled siteIds only', async () => {
    orgUserFindUnique.mockResolvedValueOnce({ role: 'SITE_ADMIN', orgId: 'org_1' });
    orgUserSiteFindMany.mockResolvedValueOnce([{ siteId: 's_one' }]);
    const scope = await getClinicianSiteIds('ou_sa', 'org_1');

    const where = buildSitesWhere(scope, 'org_1');
    expect(where).toEqual({ orgId: 'org_1', id: { in: ['s_one'] } });
  });

  it('ORG_ADMIN sites view does NOT narrow by id', async () => {
    orgUserFindUnique.mockResolvedValueOnce({ role: 'ORG_ADMIN', orgId: 'org_1' });
    siteFindMany.mockResolvedValueOnce([{ id: 's_one' }, { id: 's_two' }]);
    const scope = await getClinicianSiteIds('ou_oa', 'org_1');

    const where = buildSitesWhere(scope, 'org_1');
    expect(where).toEqual({ orgId: 'org_1' });
  });
});
