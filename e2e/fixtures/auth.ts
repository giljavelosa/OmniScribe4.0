import { type Browser, type BrowserContext, type Page, expect } from '@playwright/test';

import { SEED_USERS, type SeededUserKey, authStatePath } from './seeded-users';

/**
 * Programmatic sign-in helper.
 *
 * Why we drive the form instead of POSTing /api/auth/signin directly:
 * NextAuth v5 with the credentials provider has a CSRF flow that's
 * easier to authenticate through the actual login form (which we
 * already trust because `auth.spec.ts` exercises it). One extra
 * second per role-once-per-suite is fine.
 *
 * The sign-in flow on /login form is:
 *   1. Fill email + password.
 *   2. Click "Sign in".
 *   3. Form awaits getSession() retries (up to 3 × 150ms — see
 *      src/app/(auth)/login/_components/login-form.tsx) so the JWT
 *      cookie is reliably present before the hard-nav.
 *   4. window.location.assign('/home').
 *
 * We assert we landed at /home (or /onboarding/profile for clinicians
 * with incomplete profiles) before saving the storage state.
 */
export async function signInViaForm(page: Page, role: SeededUserKey): Promise<void> {
  const user = SEED_USERS[role];
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  // The form does a hard navigation via window.location.assign — we
  // can't rely on Playwright's automatic nav-wait. Wait for the
  // post-signin landing URL pattern instead.
  await page.waitForURL(/\/(home|onboarding\/profile)$/, { timeout: 15_000 });
}

/**
 * Save the post-sign-in storage state for a role to a known file
 * path so individual specs can `test.use({ storageState })` and
 * skip the form. Only called from globalSetup.
 */
export async function saveAuthState(
  browser: Browser,
  role: SeededUserKey,
): Promise<void> {
  // newContext() doesn't inherit Playwright's `use.baseURL`, so we
  // pass it explicitly. Otherwise `page.goto('/login')` fails with
  // "Cannot navigate to invalid URL".
  const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? '3000'}`;
  const context: BrowserContext = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await signInViaForm(page, role);
  // For non-CLINICIAN roles (admin, viewer, owner) we should be at
  // /home directly. The CLINICIAN path may detour through
  // /onboarding/profile if the seeded user doesn't have a concrete
  // profession; we don't currently exercise that detour from this
  // helper because the seeded `clinician@demo.local` already has
  // professionType=MD set.
  expect(page.url()).toMatch(/\/(home|onboarding\/profile)$/);
  await context.storageState({ path: authStatePath(role) });
  await context.close();
}

/**
 * Sign-out helper for the rare specs that need a fresh signed-out
 * state (e.g. auth.spec.ts asserting the form rejects a bad password
 * without inheriting a logged-in session).
 *
 * Uses the GET /api/auth/signout path which is idempotent.
 */
export async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/');
}
