/**
 * Seed-credential map — kept in sync with `docs/SEED_CREDENTIALS.md`
 * and `prisma/seed.ts`. Specs import from here so a future seed change
 * (renaming a demo email, dropping a role) breaks ONE place, not 8.
 *
 * Local dev only — never use these passwords in any deployed
 * environment.
 */

export const SEED_PASSWORD = 'Demo1234!' as const;

export const SEED_USERS = {
  /** Org-wide admin — seeded CONCRETE (`division: MEDICAL`,
   *  `professionType: MD`). ORG_ADMIN is recording-capable, so it must
   *  carry a concrete profession + division; the profile-completion gate
   *  bypasses VIEWER only, and admin now passes it by being complete (not
   *  by a role bypass). The org itself stays MULTI. */
  admin: {
    email: 'admin@demo.local',
    password: SEED_PASSWORD,
    role: 'ORG_ADMIN' as const,
    homeRoute: '/home',
  },
  /** Concrete clinician — `division: MEDICAL`, `professionType: MD`,
   *  `canManagePatients: true`. The profile-gate fixture: this user
   *  passes the gate immediately. */
  clinician: {
    email: 'clinician@demo.local',
    password: SEED_PASSWORD,
    role: 'CLINICIAN' as const,
    homeRoute: '/home',
  },
  /** Read-only viewer. Useful for negative-permission tests. */
  viewer: {
    email: 'viewer@demo.local',
    password: SEED_PASSWORD,
    role: 'VIEWER' as const,
    homeRoute: '/home',
  },
  /** Owner with platformRole=PLATFORM_OWNER. Has access to /owner/*.
   *  OrgRole CLINICIAN, seeded concrete (`division: MEDICAL`,
   *  `professionType: MD`) so it can start a visit. */
  owner: {
    email: 'owner@demo.local',
    password: SEED_PASSWORD,
    role: 'CLINICIAN' as const,
    homeRoute: '/home',
  },
} as const satisfies Record<
  string,
  {
    email: string;
    password: string;
    role: 'ORG_ADMIN' | 'SITE_ADMIN' | 'CLINICIAN' | 'VIEWER';
    homeRoute: string;
  }
>;

export type SeededUserKey = keyof typeof SEED_USERS;

/**
 * Storage-state file path per role. globalSetup writes these once;
 * specs declare `test.use({ storageState })` to load the cached
 * NextAuth session cookie. Cuts ~5s off every spec because the
 * sign-in form's getSession() retry loop doesn't have to run.
 */
export function authStatePath(role: SeededUserKey): string {
  return `e2e/.auth/${role}.json`;
}

/**
 * A small set of seeded patients we can rely on by name.
 *
 * Patient IDs (`cmpl…`) ARE deterministic across `npx prisma db seed`
 * invocations because cuid2 ids land in seed-corpus/*.ts. We could
 * import them here — but binding the e2e tests to those exact ids
 * would couple us to seed implementation details. Searching by name
 * instead is more user-realistic and survives a seed refactor.
 */
export const SEED_PATIENTS = {
  /** Demo Clinic, REHAB-flavored corpus (left TKA, ROM tracking). */
  mariaAlvarez: {
    firstName: 'Maria',
    lastName: 'Alvarez',
    /** Searchable in `/patients` by last name. */
    searchHint: 'Alvarez',
  },
  /** Demo Clinic, MEDICAL-flavored corpus. */
  jamesPark: {
    firstName: 'James',
    lastName: 'Park',
    searchHint: 'Park',
  },
  /** Demo Clinic, mixed-division corpus. */
  devonMitchell: {
    firstName: 'Devon',
    lastName: 'Mitchell',
    searchHint: 'Mitchell',
  },
} as const;
