import { Division, OrgRole, type Profession } from '@prisma/client';

/** Subset of the NextAuth session.user shape this helper inspects. */
type ProfileShape = {
  role: OrgRole | null;
  division: Division | null;
  professionType: Profession | null;
};

/** VIEWER is read-only — never records, so it doesn't need a categorical
 *  division/profession. Every other role (CLINICIAN, plus admins who may
 *  also see patients) is gated when they actually try to start a visit. */
const BYPASSED_ROLES: OrgRole[] = [OrgRole.VIEWER];

/** Returns true when the user must complete their profile before reaching
 *  a recording-entry surface (`/prepare` or `/capture`). Conditions:
 *  role is non-null AND not VIEWER AND (division is missing-or-MULTI OR
 *  professionType is null). The gate is invoked at the recording pages
 *  themselves so admins can still use /home, /patients, and /admin
 *  freely — they only hit the form when they try to start a visit. */
export function requiresProfileCompletion(user: ProfileShape): boolean {
  if (!user.role || BYPASSED_ROLES.includes(user.role)) return false;
  if (!user.division || user.division === Division.MULTI) return true;
  if (!user.professionType) return true;
  return false;
}
