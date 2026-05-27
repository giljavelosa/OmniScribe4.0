import { expect, test } from '@playwright/test';

import { SEED_USERS, authStatePath } from './fixtures/seeded-users';

/**
 * Authentication — the sign-in form behavior and post-signin landing.
 * Runs WITHOUT the cached storage state because the whole point is to
 * exercise the form. Other specs reuse `storageState` from
 * globalSetup.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('auth — sign-in form', () => {
  test('happy path: admin signs in and lands on /home', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(SEED_USERS.admin.email);
    await page.getByLabel('Password').fill(SEED_USERS.admin.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/home', { timeout: 15_000 });

    // The admin's email shows in the header bar — visible proof the
    // session was minted and the layout authed against it.
    await expect(page.locator('text=admin@demo.local').first()).toBeVisible();
  });

  test('happy path: clinician signs in and lands on /home', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(SEED_USERS.clinician.email);
    await page.getByLabel('Password').fill(SEED_USERS.clinician.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/home', { timeout: 15_000 });
  });

  test('rejects an invalid password without leaking which field was wrong', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(SEED_USERS.admin.email);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();

    // The form returns a single error message; we don't expose
    // "user exists, password wrong" vs "user not found" (account
    // enumeration prevention).
    await expect(
      page.getByText(/invalid email or password/i),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('an unknown email shows the same generic error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody@nowhere.local');
    await page.getByLabel('Password').fill('whatever');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(
      page.getByText(/invalid email or password/i),
    ).toBeVisible();
  });
});

test.describe('auth — protected route redirects', () => {
  test('unauthenticated /home redirects to /login', async ({ page }) => {
    await page.goto('/home');
    await expect(page).toHaveURL(/\/login/);
  });

  test('unauthenticated /patients redirects to /login', async ({ page }) => {
    await page.goto('/patients');
    await expect(page).toHaveURL(/\/login/);
  });

  test('unauthenticated /admin/users redirects to /login', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('auth — cached storageState reuse', () => {
  test.use({ storageState: authStatePath('admin') });

  test('admin storage state lets us hit /home directly', async ({ page }) => {
    await page.goto('/home');
    // Admin should be at /home, not bounced to /login.
    await expect(page).toHaveURL(/\/home$/);
  });
});
