import type { OrgRole, Division, PlatformRole } from '@prisma/client';

/**
 * FeatureKey — the canonical set of capability gates checked by API routes
 * and server components. Matches context/architecture.md "Auth & Access Model".
 * Append new keys as new units introduce new surfaces; existing keys never
 * rename (consumers reference them by string).
 */
export type FeatureKey =
  | 'NOTE_CREATE'
  | 'NOTE_EDIT'
  | 'NOTE_REVIEW'
  | 'NOTE_SIGN'
  | 'VOICE_ID'
  | 'PATIENT_MANAGEMENT'
  | 'TEMPLATE_MANAGEMENT'
  | 'BILLING_MANAGE'
  | 'TEAM_MEMBERS_MANAGE'
  | 'TRANSCRIPT_VIEW'
  | 'VOICE_PROFILE_MANAGE'
  | 'VISITS_CREATE'
  | 'TEMPLATE_LIBRARY_READ'
  | 'TEMPLATE_LIBRARY_MANAGE';

export type AuthorizationUser = {
  userId: string;
  orgUserId: string;
  orgId: string;
  role: OrgRole;
  division: Division;
  platformRole: PlatformRole;
  canManagePatients: boolean;
};
