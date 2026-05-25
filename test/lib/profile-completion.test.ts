import { describe, it, expect } from 'vitest';
import { Division, OrgRole, Profession } from '@prisma/client';

import { requiresProfileCompletion } from '@/lib/auth/profile-completion';

/**
 * Regression tests for the profile-completion gate.
 *
 * Background
 * ----------
 * The gate redirects users to `/onboarding/profile` from the recording-entry
 * surfaces (`/prepare`, `/capture`) when their identity isn't tight enough
 * for the per-note division resolver to return a deterministic answer.
 *
 * Two regressions surfaced from `admin@demo.local` (ORG_ADMIN, division=MULTI,
 * professionType=null) hitting "Start late entry":
 *
 *   1. The gate gated admins despite PR #89's stated design ("Admin / owner /
 *      site-admin / viewer roles bypass") — only VIEWER was actually exempt
 *      in code.
 *   2. After completing the form, `useSession().update()` was called with no
 *      args, which sends a GET (not POST) to `/api/auth/session` and never
 *      triggers the jwt callback's `trigger: 'update'` branch — so the JWT
 *      cookie kept the pre-save values and the gate fired again on the next
 *      `/prepare` render. (The `update()` call site is fixed in
 *      `profile-form.tsx`; this file covers the gate logic.)
 */
describe('requiresProfileCompletion', () => {
  describe('bypassed roles', () => {
    it('VIEWER is exempt regardless of division/professionType', () => {
      expect(
        requiresProfileCompletion({
          role: OrgRole.VIEWER,
          division: null,
          professionType: null,
        }),
      ).toBe(false);
    });

    it('ORG_ADMIN with MULTI + null profession is exempt (regression: was gated)', () => {
      // Mirrors the demo seed: admin@demo.local is intentionally MULTI so
      // they remain the org-aggregate identity. Forcing them through the
      // gate would permanently demote them out of MULTI (the form excludes
      // MULTI from the picker) and produce a /prepare → /onboarding/profile
      // loop because the JWT-refresh flow used to no-op.
      expect(
        requiresProfileCompletion({
          role: OrgRole.ORG_ADMIN,
          division: Division.MULTI,
          professionType: null,
        }),
      ).toBe(false);
    });

    it('SITE_ADMIN with MULTI + null profession is exempt', () => {
      expect(
        requiresProfileCompletion({
          role: OrgRole.SITE_ADMIN,
          division: Division.MULTI,
          professionType: null,
        }),
      ).toBe(false);
    });

    it('ORG_ADMIN with concrete division+profession is still exempt', () => {
      expect(
        requiresProfileCompletion({
          role: OrgRole.ORG_ADMIN,
          division: Division.MEDICAL,
          professionType: Profession.MD,
        }),
      ).toBe(false);
    });

    it('null role (no org membership) is exempt', () => {
      expect(
        requiresProfileCompletion({
          role: null,
          division: null,
          professionType: null,
        }),
      ).toBe(false);
    });
  });

  describe('CLINICIAN — gated paths', () => {
    it('null division → gated', () => {
      expect(
        requiresProfileCompletion({
          role: OrgRole.CLINICIAN,
          division: null,
          professionType: Profession.MD,
        }),
      ).toBe(true);
    });

    it('MULTI division → gated', () => {
      expect(
        requiresProfileCompletion({
          role: OrgRole.CLINICIAN,
          division: Division.MULTI,
          professionType: Profession.MD,
        }),
      ).toBe(true);
    });

    it('null professionType → gated', () => {
      expect(
        requiresProfileCompletion({
          role: OrgRole.CLINICIAN,
          division: Division.MEDICAL,
          professionType: null,
        }),
      ).toBe(true);
    });

    it('professionType=OTHER → gated (resolver requires concrete profession)', () => {
      expect(
        requiresProfileCompletion({
          role: OrgRole.CLINICIAN,
          division: Division.MEDICAL,
          professionType: Profession.OTHER,
        }),
      ).toBe(true);
    });
  });

  describe('CLINICIAN — pass paths', () => {
    it('concrete division + concrete profession → not gated', () => {
      expect(
        requiresProfileCompletion({
          role: OrgRole.CLINICIAN,
          division: Division.REHAB,
          professionType: Profession.PT,
        }),
      ).toBe(false);
    });

    it.each([
      [Division.MEDICAL, Profession.MD],
      [Division.MEDICAL, Profession.NP],
      [Division.REHAB, Profession.OT],
      [Division.REHAB, Profession.SLP],
      [Division.BEHAVIORAL_HEALTH, Profession.LCSW],
      [Division.BEHAVIORAL_HEALTH, Profession.PSYCHOLOGIST],
    ])('passes for %s + %s', (division, professionType) => {
      expect(
        requiresProfileCompletion({
          role: OrgRole.CLINICIAN,
          division,
          professionType,
        }),
      ).toBe(false);
    });
  });
});
