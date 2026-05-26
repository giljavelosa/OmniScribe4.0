import { expect, test } from '@playwright/test';

import { authStatePath } from './fixtures/seeded-users';

/**
 * Profile-completion gate (regression coverage for fix #2 — commit
 * 8d02880).
 *
 * Background
 * ----------
 * The gate sits between the recording-entry surfaces (`/prepare/[noteId]`,
 * `/capture/[noteId]`) and the user. It redirects to
 * `/onboarding/profile` if the user is a CLINICIAN with no concrete
 * `division` + `professionType`. Two regressions in this surface
 * have been fixed and need ongoing coverage:
 *
 *   1. ORG_ADMIN with `division: MULTI` (the demo seed shape) was
 *      being incorrectly redirected to /onboarding/profile, even
 *      though admins by design retain the org-aggregate division.
 *      Fix: BYPASSED_ROLES now includes ORG_ADMIN + SITE_ADMIN.
 *
 *   2. After the form save, useSession().update() with no args was a
 *      no-op (GET /api/auth/session — see next-auth v5 source) so
 *      the JWT cookie kept stale division/professionType. Re-clicking
 *      "Start late entry" looped back to the gate. Fix: pass a
 *      payload to update() so a POST + the trigger:'update' jwt
 *      callback path runs.
 *
 * The unit-test suite covers the helper logic + the
 * useSession().update() contract. These specs cover the actual
 * browser flow.
 */

test.describe('profile-completion gate — admin bypass', () => {
  test.use({ storageState: authStatePath('admin') });

  test('admin reaches /home directly (no /onboarding/profile detour)', async ({ page }) => {
    await page.goto('/home');
    await expect(page).toHaveURL(/\/home$/);
    // Sanity: we did NOT bounce through onboarding.
    await expect(page).not.toHaveURL(/\/onboarding\/profile/);
  });

  test('admin can navigate to /patients without hitting the gate', async ({ page }) => {
    await page.goto('/patients');
    await expect(page).toHaveURL(/\/patients$/);
  });

  test('admin clicking through to a patient chart does not get stuck', async ({ page }) => {
    // Search for a known seeded patient (Maria Alvarez has a rich
    // REHAB corpus) and open her chart. The chart is a recording-
    // adjacent surface; if the gate were misfiring on admins we'd
    // see /onboarding/profile here.
    await page.goto('/patients');
    // /patients renders mobile + desktop variants. `.last()` targets
    // the desktop instance which is the visible one at Desktop
    // Chrome's 1280x720 viewport.
    await page
      .getByPlaceholder(/last name, first name, or mrn/i)
      .last()
      .fill('Alvarez');
    await page.getByRole('button', { name: /^search$/i }).last().click();
    await page.waitForURL(/\/patients\?query=/);

    const row = page.getByRole('link', { name: /alvarez/i }).last();
    await row.click();
    await page.waitForURL(/\/patients\/[a-z0-9-]+$/);
    await expect(page).not.toHaveURL(/\/onboarding\/profile/);
  });
});

test.describe('profile-completion gate — clinician with concrete profession', () => {
  test.use({ storageState: authStatePath('clinician') });

  test('seeded clinician (MD, MEDICAL) passes the gate', async ({ page }) => {
    await page.goto('/home');
    await expect(page).toHaveURL(/\/home$/);
  });

  test('clinician opens a patient chart without the gate firing', async ({ page }) => {
    await page.goto('/patients');
    await page
      .getByPlaceholder(/last name, first name, or mrn/i)
      .last()
      .fill('Park');
    await page.getByRole('button', { name: /^search$/i }).last().click();
    await page.waitForURL(/\/patients\?query=/);

    const row = page.getByRole('link', { name: /park/i }).last();
    await row.click();
    await page.waitForURL(/\/patients\/[a-z0-9-]+$/);
    await expect(page).not.toHaveURL(/\/onboarding\/profile/);
  });
});

test.describe('profile-completion gate — viewer (read-only)', () => {
  test.use({ storageState: authStatePath('viewer') });

  test('viewer reaches /home (BYPASSED_ROLES includes VIEWER from day one)', async ({ page }) => {
    await page.goto('/home');
    await expect(page).toHaveURL(/\/home$/);
  });
});
