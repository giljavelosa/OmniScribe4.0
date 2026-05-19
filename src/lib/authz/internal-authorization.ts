import type { FeatureKey, AuthorizationUser } from './types';

/**
 * canUseFeature — (OrgRole × FeatureKey) matrix.
 *
 * Conservative defaults:
 *  - SUPER_ADMIN gets everything
 *  - ORG_ADMIN gets everything except VOICE_ID (clinician-only) and the
 *    clinical NOTE_CREATE/EDIT/REVIEW/SIGN
 *  - SITE_ADMIN: team management, template library reads, voice-id, visits
 *  - CLINICIAN: notes lifecycle, transcript view, voice-id, visit creation
 *  - VIEWER: read-only (NOTE_REVIEW, TRANSCRIPT_VIEW, TEMPLATE_LIBRARY_READ)
 *
 * Some keys depend on per-user toggles — PATIENT_MANAGEMENT requires
 * `canManagePatients = true` regardless of role (except SUPER_ADMIN).
 *
 * Unit 13 (templates editor) refines TEMPLATE_LIBRARY_MANAGE; Unit 11
 * (episode of care maturity) may refine NOTE_SIGN. Document any refinement
 * here with a comment + commit reference.
 */
const BASE_MATRIX: Record<string, ReadonlyArray<FeatureKey>> = {
  SUPER_ADMIN: [
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
  ORG_ADMIN: [
    'BILLING_MANAGE',
    'TEAM_MEMBERS_MANAGE',
    'TEMPLATE_MANAGEMENT',
    'TEMPLATE_LIBRARY_READ',
    'TEMPLATE_LIBRARY_MANAGE',
    'TRANSCRIPT_VIEW',
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
    'VISITS_CREATE',
  ],
  VIEWER: ['NOTE_REVIEW', 'TRANSCRIPT_VIEW', 'TEMPLATE_LIBRARY_READ'],
};

export function canUseFeature(featureKey: FeatureKey, user: AuthorizationUser): boolean {
  // PATIENT_MANAGEMENT is a special case: gated by the per-user
  // `canManagePatients` toggle rather than the role's base matrix. The
  // toggle exists precisely so non-SUPER_ADMIN roles (clinicians, site
  // admins, org admins) can be granted patient-create rights selectively
  // without expanding their full role permission set. SUPER_ADMIN bypasses
  // the toggle entirely; VIEWER never gets it regardless.
  if (featureKey === 'PATIENT_MANAGEMENT') {
    if (user.role === 'SUPER_ADMIN') return true;
    if (user.role === 'VIEWER') return false;
    return user.canManagePatients;
  }

  const allowed = BASE_MATRIX[user.role] ?? [];
  return allowed.includes(featureKey);
}
