import { expect, test } from '@playwright/test';

import { authStatePath } from './fixtures/seeded-users';

/**
 * Visit-bank billing UI — Group C surfaces:
 *   - /admin/billing: team plan, solo plan, collaborator add-on, bundles
 *   - /signup: solo vs org trial selection
 *   - /owner/orgs/[id]: commercial contract + catalog defaults
 *
 * Checkout buttons are not clicked — Stripe redirect is out of scope for
 * local e2e. Structural render + catalog load is what we lock here.
 */

test.describe('Admin billing — visit bank catalog UI', () => {
  test.use({ storageState: authStatePath('admin') });

  test('GET /admin/billing renders Group C plan sections', async ({ page }) => {
    await page.goto('/admin/billing');
    await expect(page.getByRole('heading', { name: /^billing$/i })).toBeVisible();

    await expect(page.getByText('Team visit bank — monthly plan', { exact: true })).toBeVisible();
    await expect(page.getByText('Solo visit bank — monthly plan', { exact: true })).toBeVisible();
    await expect(page.getByText('Collaborator seat add-on', { exact: true })).toBeVisible();
    await expect(page.getByText('Visit top-up bundles', { exact: true })).toBeVisible();
  });

  test('team plan catalog loads and shows monthly quote', async ({ page }) => {
    await page.goto('/admin/billing');

    const seatsInput = page.getByLabel('Clinician seats');
    await expect(seatsInput).toBeVisible({ timeout: 10_000 });
    await seatsInput.fill('5');

    await expect(page.getByText(/\/mo · \d+ visits\/month/i)).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole('button', { name: /subscribe — team plan/i }),
    ).toBeEnabled();
  });

  test('solo tier selector and bundle selector populate from catalog', async ({ page }) => {
    await page.goto('/admin/billing');

    await expect(page.getByRole('button', { name: /subscribe — /i }).first()).toBeEnabled({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: /buy \+/i })).toBeEnabled({ timeout: 10_000 });
  });
});

test.describe('Signup — trial kind selection', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('GET /signup exposes solo vs team trial choice', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByText('Create your org', { exact: true })).toBeVisible();

    await expect(page.getByText('Who is signing up?', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('combobox').filter({ hasText: /just me — solo clinician/i }),
    ).toBeVisible();
    await expect(page.getByText(/14-day trial with visit bank for one clinician/i)).toBeVisible();
  });

  test('switching to team trial updates helper copy', async ({ page }) => {
    await page.goto('/signup');
    await page.getByRole('combobox').filter({ hasText: /just me/i }).click();
    await page.getByRole('option', { name: /our practice/i }).click();
    await expect(
      page.getByText(/14-day team trial with multiple seats and a shared visit bank/i),
    ).toBeVisible();
  });
});

test.describe('Admin capacity — allocate flow', () => {
  test.use({ storageState: authStatePath('admin') });

  test('GET /admin/capacity shows bank balance and user wallets', async ({ page }) => {
    await page.goto('/admin/capacity');
    await expect(page.getByRole('heading', { name: /^visit capacity$/i })).toBeVisible();
    await expect(page.getByText('Org visit bank', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('User wallets', { exact: true })).toBeVisible();
    await expect(page.getByText(/visits$/i).first()).toBeVisible();
  });

  test('allocate button is present for seeded clinician wallet', async ({ page }) => {
    await page.goto('/admin/capacity');
    await expect(page.getByRole('button', { name: /^allocate$/i }).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe('Owner commercial contract — catalog defaults', () => {
  test.use({ storageState: authStatePath('owner') });

  test('Demo Clinic commercial card loads and shows apply-defaults control', async ({ page }) => {
    await page.goto('/owner/orgs');
    await page.getByRole('link', { name: 'Demo Clinic' }).click();
    await expect(page).toHaveURL(/\/owner\/orgs\//);

    await expect(page.getByText('Commercial contract', { exact: true })).toBeVisible();
    await expect(page.getByText('Bank balance:', { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole('button', { name: /apply catalog enterprise defaults/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
