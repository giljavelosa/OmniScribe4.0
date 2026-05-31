import { Division, OrgRole, Profession } from '@prisma/client';
import { divisionForProfession } from '@/lib/professions';

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
 *  professionType is null-or-OTHER OR division disagrees with the profession).
 *  OTHER is refused because note division is now derived from profession
 *  (PROFESSION_TO_DIVISION) and OTHER maps to null — a recording clinician must
 *  pick a concrete profession so the resolver has a deterministic answer.
 *
 *  The consistency clause catches legacy rows whose stored division contradicts
 *  their profession (e.g. a PT stuck on MEDICAL): it routes them back through the
 *  derive-from-profession form, self-healing the row on next login even without
 *  the one-time data migration. */
export function requiresProfileCompletion(user: ProfileShape): boolean {
  if (!user.role || BYPASSED_ROLES.includes(user.role)) return false;
  if (!user.division || user.division === Division.MULTI) return true;
  if (!user.professionType || user.professionType === Profession.OTHER) return true;
  const expected = divisionForProfession(user.professionType);
  if (expected && user.division !== expected) return true;
  return false;
}
