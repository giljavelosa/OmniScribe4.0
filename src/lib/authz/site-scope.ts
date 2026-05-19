/**
 * Site scope for clinician multi-site enrollment.
 * Spec: context/specs/clinician-site-enrollment.md
 *
 * Org-wide roles (ORG_ADMIN, plus PLATFORM_OWNER / PLATFORM_OPS) implicitly
 * cover every site in scope. They do NOT need OrgUserSite rows — this helper
 * treats them as "all sites" automatically. This avoids forcing org admins to
 * enroll at every site.
 *
 * SITE_ADMIN, CLINICIAN, and VIEWER are scoped to the OrgUserSite rows that
 * have been written for them. A clinician with zero enrollments has zero
 * accessible sites — POST /api/encounters / schedules will return 400
 * site_not_enrolled, which is the correct UX cue ("ask your admin to enroll
 * you at a site").
 *
 * This helper is a SUPPLEMENT to `requireFeatureAccess`, not a replacement.
 * Feature gates still control "can this role do X at all"; site scope adds
 * "and at which sites."
 */

import type { OrgRole, Prisma, PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from '@/lib/prisma';

type Tx = Prisma.TransactionClient | PrismaClient;

export type SiteScope =
  | { scope: 'all'; siteIds: string[] }
  | { scope: 'enrolled'; siteIds: string[] };

/** Org-wide roles get "all sites" implicitly (no OrgUserSite row required). */
const ALL_SITES_ROLES: ReadonlyArray<OrgRole> = ['ORG_ADMIN'];

export function isAllSitesRole(role: OrgRole): boolean {
  return ALL_SITES_ROLES.includes(role);
}

/**
 * Returns the set of siteIds the given OrgUser can act on within their org.
 *
 *  - scope: 'all'      → all non-archived sites in the org. Used for
 *                        ORG_ADMIN+ and seamless bypass paths.
 *  - scope: 'enrolled' → the explicit OrgUserSite list for this clinician.
 *
 * Pass a `tx` to participate in a caller transaction. Without a tx the
 * default prisma client is used. The lookup runs at most one role lookup +
 * one site/enrollment list, so it's safe to call per request.
 *
 * Note: archived sites are filtered out for the 'all' branch so a brand-new
 * org admin doesn't accidentally schedule onto a sunset location.
 */
export async function getClinicianSiteIds(
  orgUserId: string,
  orgId: string,
  tx: Tx = defaultPrisma,
): Promise<SiteScope> {
  const orgUser = await tx.orgUser.findUnique({
    where: { id: orgUserId },
    select: { role: true, orgId: true },
  });
  // Defense in depth: if the OrgUser row doesn't match the claimed org,
  // return an empty enrolled scope rather than leaking another org's sites.
  if (!orgUser || orgUser.orgId !== orgId) {
    return { scope: 'enrolled', siteIds: [] };
  }

  if (isAllSitesRole(orgUser.role)) {
    const sites = await tx.site.findMany({
      where: { orgId, isArchived: false },
      select: { id: true },
    });
    return { scope: 'all', siteIds: sites.map((s) => s.id) };
  }

  const rows = await tx.orgUserSite.findMany({
    where: { orgUserId },
    select: { siteId: true },
  });
  return { scope: 'enrolled', siteIds: rows.map((r) => r.siteId) };
}

/**
 * True when the clinician is permitted to act at the given siteId.
 * Org-wide roles always pass. Empty enrollment → false (clinician with no
 * site assignments cannot schedule or start visits anywhere until an admin
 * enrolls them).
 */
export function canActAtSite(scope: SiteScope, siteId: string): boolean {
  if (scope.scope === 'all') return true;
  return scope.siteIds.includes(siteId);
}
