import { Division, OrgRole, type Profession } from '@prisma/client';

/** Subset of the NextAuth session.user shape this helper inspects. */
type ProfileShape = {
  role: OrgRole | null;
  division: Division | null;
  professionType: Profession | null;
};

/** Roles whose primary surface is /capture and the clinical chart — they
 *  must have a concrete division + categorical profession. Admin / viewer
 *  / org-admin roles bypass the gate. */
const GATED_ROLES: OrgRole[] = [OrgRole.CLINICIAN];

/** Returns true when the current user must complete their profile before
 *  reaching any (clinical) route. Conditions: role is a clinical role AND
 *  (division is missing-or-MULTI OR professionType is null). */
export function requiresProfileCompletion(user: ProfileShape): boolean {
  if (!user.role || !GATED_ROLES.includes(user.role)) return false;
  if (!user.division || user.division === Division.MULTI) return true;
  if (!user.professionType) return true;
  return false;
}
