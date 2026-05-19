import { Division, OrgRole, Profession } from '@prisma/client';

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
 *  professionType is null-or-OTHER). OTHER is refused because note division
 *  is now derived from profession (PROFESSION_TO_DIVISION) and OTHER maps
 *  to null — a recording clinician must pick a concrete profession so the
 *  resolver has a deterministic answer. */
export function requiresProfileCompletion(user: ProfileShape): boolean {
  if (!user.role || BYPASSED_ROLES.includes(user.role)) return false;
  if (!user.division || user.division === Division.MULTI) return true;
  if (!user.professionType || user.professionType === Profession.OTHER) return true;
  return false;
}
