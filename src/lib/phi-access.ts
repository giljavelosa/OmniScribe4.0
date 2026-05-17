/**
 * PHI scoping helpers (spec §I).
 *
 *   canAccessClinicianOwnedResource — predicate for objects bearing
 *     { orgId, clinicianOrgUserId? }. CLINICIANs only see their own; admins
 *     see all org rows.
 *
 *   assertOrgScoped — defense-in-depth helper. Call after every PHI Prisma
 *     query to confirm the row's orgId matches the requestor's. Throws on
 *     mismatch (caller's 500 path should surface as "internal error" to the
 *     client — never leak that another org's row exists).
 *
 * Anti-regression rule: every PHI Prisma query MUST include orgId in its
 * WHERE clause. assertOrgScoped does not relax that requirement; it backstops
 * it.
 */

import type { OrgRole } from '@prisma/client';

export function canAccessClinicianOwnedResource(
  resource: { orgId: string; clinicianOrgUserId?: string | null },
  user: { orgId: string; orgUserId: string; role: OrgRole },
): boolean {
  if (resource.orgId !== user.orgId) return false;
  if (user.role === 'CLINICIAN' && resource.clinicianOrgUserId && resource.clinicianOrgUserId !== user.orgUserId) {
    return false;
  }
  return true;
}

export class OrgScopeMismatchError extends Error {
  constructor(actualOrgId: string, expectedOrgId: string) {
    super(`org-scope mismatch: actual=${actualOrgId} expected=${expectedOrgId}`);
    this.name = 'OrgScopeMismatchError';
  }
}

export function assertOrgScoped(actualOrgId: string, expectedOrgId: string): void {
  if (actualOrgId !== expectedOrgId) throw new OrgScopeMismatchError(actualOrgId, expectedOrgId);
}
