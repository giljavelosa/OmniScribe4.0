import { Division, OrgRole, Profession } from '@prisma/client';

/** Subset of the NextAuth session.user shape this helper inspects. */
type ProfileShape = {
  role: OrgRole | null;
  division: Division | null;
  professionType: Profession | null;
};

/** Roles that bypass the gate.
 *
 * VIEWER is read-only — never records.
 *
 * ORG_ADMIN and SITE_ADMIN are intentionally kept on `division: MULTI` /
 * null `professionType` so they remain the org-aggregate identity used
 * across all divisions; forcing them to "pick a side" through the gate
 * would permanently demote them out of MULTI (the form excludes MULTI
 * from `CLINICIAN_PICKABLE_DIVISIONS`). Per the original design intent
 * (PR #89: "Admin / owner / site-admin / viewer roles bypass") admins
 * who occasionally record fall through to the per-encounter resolver,
 * which lands on `org.defaultDivision` / `org.division` for them.
 *
 * CLINICIAN is the one role that MUST declare a concrete scope of
 * practice before recording — that's what the gate is for. */
const BYPASSED_ROLES: OrgRole[] = [
  OrgRole.VIEWER,
  OrgRole.ORG_ADMIN,
  OrgRole.SITE_ADMIN,
];

/** Returns true when the user must complete their profile before reaching
 *  a recording-entry surface (`/prepare` or `/capture`). Conditions:
 *  role is CLINICIAN AND (division is missing-or-MULTI OR professionType
 *  is null-or-OTHER). OTHER is refused because note division is now
 *  derived from profession (PROFESSION_TO_DIVISION) and OTHER maps to
 *  null — a recording clinician must pick a concrete profession so the
 *  resolver has a deterministic answer. */
export function requiresProfileCompletion(user: ProfileShape): boolean {
  if (!user.role || BYPASSED_ROLES.includes(user.role)) return false;
  if (!user.division || user.division === Division.MULTI) return true;
  if (!user.professionType || user.professionType === Profession.OTHER) return true;
  return false;
}
