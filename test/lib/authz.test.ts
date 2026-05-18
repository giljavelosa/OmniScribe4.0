import { describe, it, expect } from 'vitest';
import { canUseFeature } from '@/lib/authz/internal-authorization';
import type { AuthorizationUser } from '@/lib/authz/types';
import { canAccessClinicianOwnedResource, assertOrgScoped, OrgScopeMismatchError } from '@/lib/phi-access';
import type { OrgRole, Division, PlatformRole } from '@prisma/client';

function mkUser(over: Partial<AuthorizationUser> = {}): AuthorizationUser {
  return {
    userId: 'u1',
    orgUserId: 'ou1',
    orgId: 'org1',
    role: 'CLINICIAN' as OrgRole,
    division: 'MEDICAL' as Division,
    platformRole: 'NONE' as PlatformRole,
    canManagePatients: false,
    ...over,
  };
}

describe('canUseFeature matrix', () => {
  it('SUPER_ADMIN can do everything', () => {
    const u = mkUser({ role: 'SUPER_ADMIN' as OrgRole });
    expect(canUseFeature('NOTE_SIGN', u)).toBe(true);
    expect(canUseFeature('TEAM_MEMBERS_MANAGE', u)).toBe(true);
    expect(canUseFeature('PATIENT_MANAGEMENT', u)).toBe(true);
    expect(canUseFeature('BILLING_MANAGE', u)).toBe(true);
  });

  it('CLINICIAN can sign notes but not manage team', () => {
    const u = mkUser({ role: 'CLINICIAN' as OrgRole });
    expect(canUseFeature('NOTE_SIGN', u)).toBe(true);
    expect(canUseFeature('TEAM_MEMBERS_MANAGE', u)).toBe(false);
    expect(canUseFeature('BILLING_MANAGE', u)).toBe(false);
  });

  it('VIEWER can review but not edit/sign', () => {
    const u = mkUser({ role: 'VIEWER' as OrgRole });
    expect(canUseFeature('NOTE_REVIEW', u)).toBe(true);
    expect(canUseFeature('NOTE_EDIT', u)).toBe(false);
    expect(canUseFeature('NOTE_SIGN', u)).toBe(false);
  });

  it('PATIENT_MANAGEMENT requires canManagePatients=true for non-SUPER_ADMINs', () => {
    expect(canUseFeature('PATIENT_MANAGEMENT', mkUser({ role: 'CLINICIAN', canManagePatients: false }))).toBe(false);
    expect(canUseFeature('PATIENT_MANAGEMENT', mkUser({ role: 'CLINICIAN', canManagePatients: true }))).toBe(false);
    // CLINICIAN doesn't have PATIENT_MANAGEMENT in their matrix either way (Unit 02 may refine)
    expect(canUseFeature('PATIENT_MANAGEMENT', mkUser({ role: 'SUPER_ADMIN', canManagePatients: false }))).toBe(true);
  });

  it('ORG_ADMIN gets team + billing, not clinical', () => {
    const u = mkUser({ role: 'ORG_ADMIN' as OrgRole });
    expect(canUseFeature('TEAM_MEMBERS_MANAGE', u)).toBe(true);
    expect(canUseFeature('BILLING_MANAGE', u)).toBe(true);
    expect(canUseFeature('NOTE_SIGN', u)).toBe(false);
  });
});

describe('phi-access', () => {
  it('blocks cross-org access', () => {
    expect(
      canAccessClinicianOwnedResource(
        { orgId: 'org2', clinicianOrgUserId: 'ouX' },
        { orgId: 'org1', orgUserId: 'ou1', role: 'CLINICIAN' as OrgRole },
      ),
    ).toBe(false);
  });

  it('lets a CLINICIAN see only their own clinician-owned rows', () => {
    expect(
      canAccessClinicianOwnedResource(
        { orgId: 'org1', clinicianOrgUserId: 'ou1' },
        { orgId: 'org1', orgUserId: 'ou1', role: 'CLINICIAN' as OrgRole },
      ),
    ).toBe(true);
    expect(
      canAccessClinicianOwnedResource(
        { orgId: 'org1', clinicianOrgUserId: 'ouX' },
        { orgId: 'org1', orgUserId: 'ou1', role: 'CLINICIAN' as OrgRole },
      ),
    ).toBe(false);
  });

  it('lets admins see any clinician-owned row in their org', () => {
    expect(
      canAccessClinicianOwnedResource(
        { orgId: 'org1', clinicianOrgUserId: 'ouX' },
        { orgId: 'org1', orgUserId: 'ou1', role: 'ORG_ADMIN' as OrgRole },
      ),
    ).toBe(true);
  });

  it('assertOrgScoped throws on mismatch', () => {
    expect(() => assertOrgScoped('org1', 'org2')).toThrow(OrgScopeMismatchError);
    expect(() => assertOrgScoped('org1', 'org1')).not.toThrow();
  });
});
