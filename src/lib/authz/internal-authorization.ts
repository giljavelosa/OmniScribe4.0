import type { FeatureKey, AuthorizationUser } from './types';

/**
 * canUseFeature — (OrgRole × FeatureKey) matrix.
 *
 * Role model:
 *  - ORG_ADMIN — top org role. Absorbs every feature previously held by the
 *    removed (consolidated into PlatformRole): full clinical lifecycle (NOTE_*,
 *    VOICE_ID, VISITS_CREATE) AND admin features (billing, team members,
 *    templates, template library, transcript view). Bypass authority for
 *    reading any note in the org lives in route-level checks (`role !==
 *    'ORG_ADMIN'`).
 *  - SITE_ADMIN — team management within scope, template library reads,
 *    voice-id, visit creation.
 *  - CLINICIAN — notes lifecycle, transcript view, voice-id, visit creation.
 *  - VIEWER — read-only (NOTE_REVIEW, TRANSCRIPT_VIEW, TEMPLATE_LIBRARY_READ).
 *    Cannot record visits or edit notes (cross-checked by route gates).
 *
 * PATIENT_MANAGEMENT is gated by the per-user `canManagePatients` toggle for
 * non-VIEWER roles. ORG_ADMIN bypasses the toggle. VIEWER never gets it.
 *
 * Platform-owner authority (cross-org, BAA, subscription, impersonation) is
 * entirely separate and lives on `User.platformRole = PLATFORM_OWNER`.
 */
const BASE_MATRIX: Record<string, ReadonlyArray<FeatureKey>> = {
  ORG_ADMIN: [
    'NOTE_CREATE',
    'NOTE_EDIT',
    'NOTE_REVIEW',
    'NOTE_SIGN',
    'VOICE_ID',
    'PATIENT_MANAGEMENT',
    'TEMPLATE_MANAGEMENT',
    'BILLING_MANAGE',
    'TEAM_MEMBERS_MANAGE',
    'TRANSCRIPT_VIEW',
    'VOICE_PROFILE_MANAGE',
    'VISITS_CREATE',
    'TEMPLATE_LIBRARY_READ',
    'TEMPLATE_LIBRARY_MANAGE',
  ],
  SITE_ADMIN: [
    'TEAM_MEMBERS_MANAGE',
    'TEMPLATE_LIBRARY_READ',
    'TRANSCRIPT_VIEW',
    'VISITS_CREATE',
  ],
  CLINICIAN: [
    'NOTE_CREATE',
    'NOTE_EDIT',
    'NOTE_REVIEW',
    'NOTE_SIGN',
    'VOICE_ID',
    'VOICE_PROFILE_MANAGE',
    'TRANSCRIPT_VIEW',
    'TEMPLATE_LIBRARY_READ',
    // Personal-templates (Option A): clinicians may create / edit /
    // archive / clone their OWN `PERSONAL` templates. Route-level
    // guards (see `src/app/api/admin/templates/**`) enforce that a
    // non-admin caller cannot touch TEAM / PUBLIC / preset rows or
    // another clinician's PERSONAL row. The permission key only
    // unlocks the route family; row-level authority is per-row.
    'TEMPLATE_LIBRARY_MANAGE',
    'VISITS_CREATE',
  ],
  VIEWER: ['NOTE_REVIEW', 'TRANSCRIPT_VIEW', 'TEMPLATE_LIBRARY_READ'],
};

/**
 * Admin-role predicate — single source of truth for the role-based half
 * of the templates row-level guards. ORG_ADMIN keeps full authority over
 * org templates; SITE_ADMIN treated as non-admin for template authoring
 * (matches the base matrix — SITE_ADMIN has READ only). Platform owner
 * elevation is handled separately by the route's caller chain.
 */
export function isOrgAdminRole(role: string | null | undefined): boolean {
  return role === 'ORG_ADMIN';
}

export function canUseFeature(featureKey: FeatureKey, user: AuthorizationUser): boolean {
  // PATIENT_MANAGEMENT is gated by the per-user `canManagePatients` toggle
  // rather than the role's base matrix. The toggle exists precisely so
  // non-ORG_ADMIN roles (clinicians, site admins) can be granted patient-
  // create rights selectively without expanding their full role permission
  // set. ORG_ADMIN bypasses the toggle. VIEWER never gets it.
  if (featureKey === 'PATIENT_MANAGEMENT') {
    if (user.role === 'ORG_ADMIN') return true;
    if (user.role === 'VIEWER') return false;
    return user.canManagePatients;
  }

  const allowed = BASE_MATRIX[user.role] ?? [];
  return allowed.includes(featureKey);
}
