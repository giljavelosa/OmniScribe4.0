import { expect, test } from '@playwright/test';

import { authStatePath, SEED_PATIENTS } from './fixtures/seeded-users';

/**
 * Patient search & navigation — the most-used UI flow. Validates:
 *
 *   - The home cockpit's search input routes to /patients?query=…
 *   - The /patients list filters down to the matching patient.
 *   - Clicking the row navigates to the chart (with a URL that
 *     looks like /patients/cmpl…).
 *   - The chart's identity header shows the patient name.
 *
 * Uses cached `clinician` storage state so the suite doesn't sign in
 * again for every spec.
 */

test.describe('patient search & navigation', () => {
  test.use({ storageState: authStatePath('clinician') });

  test('home → search Alvarez → patients list shows Alvarez', async ({ page }) => {
    await page.goto('/home');
    // The home page renders BOTH mobile + desktop search forms (the
    // mobile one is `lg:hidden`, the desktop one is `hidden lg:grid`).
    // At Desktop Chrome's 1280x720 viewport only the DESKTOP form is
    // visible. Mobile comes first in DOM order, so we use `.last()`
    // to target the visible desktop form.
    await page
      .getByPlaceholder(/last name, first name, or mrn/i)
      .last()
      .fill(SEED_PATIENTS.mariaAlvarez.searchHint);
    await page.getByRole('button', { name: /^search$/i }).last().click();
    await page.waitForURL(/\/patients\?query=Alvarez/);

    // The /patients list also renders mobile + desktop. The first
    // visible link in the desktop variant is what we want.
    await expect(
      page.getByRole('link', { name: /alvarez/i }).last(),
    ).toBeVisible();
  });

  test('clicking a search result navigates to /patients/[id] chart', async ({ page }) => {
    await page.goto('/patients?query=Alvarez');
    // Click the desktop-table row, not the hidden mobile card.
    const row = page.getByRole('link', { name: /alvarez/i }).last();
    await row.click();
    // Patient ids may be cuid2 (`cmpm…`) OR seed-prefixed strings
    // (`seed-patient-medical`). Allow hyphens in the id segment.
    await page.waitForURL(/\/patients\/[a-z0-9-]+$/);
    // The chart's identity strip uses a <span>, not <h1>, so we
    // assert the patient name as visible text.
    await expect(page.getByText(/alvarez/i).first()).toBeVisible();
  });

  test('an unknown query renders a friendly empty state', async ({ page }) => {
    await page.goto('/patients?query=ZZZ_DOES_NOT_EXIST');
    // Both mobile + desktop variants render EmptyState. Use `.last()`
    // so we assert the visible desktop instance.
    await expect(
      page.getByText(/no patients matching/i).last(),
    ).toBeVisible();
  });

  test('multi-patient search across distinct seeds (Park, Mitchell)', async ({ page }) => {
    // Ensures we're not accidentally constraining results to one
    // patient via overly-narrow seeded data.
    for (const patient of [SEED_PATIENTS.jamesPark, SEED_PATIENTS.devonMitchell]) {
      await page.goto(`/patients?query=${encodeURIComponent(patient.searchHint)}`);
      await expect(
        page.getByRole('link', { name: new RegExp(patient.lastName, 'i') }).first(),
      ).toBeVisible();
    }
  });
});

test.describe('AppNav — top header reflects the user', () => {
  test.use({ storageState: authStatePath('admin') });

  test('admin sees Home, Patients, Administration links', async ({ page }) => {
    await page.goto('/home');
    // Look at the top app-nav region. AppNav lives in the clinical
    // layout header, not in the cockpit body.
    await expect(page.getByRole('link', { name: /^home$/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /^patients$/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /^administration$/i }).first()).toBeVisible();
  });
});

test.describe('AppNav — clinician role gating', () => {
  test.use({ storageState: authStatePath('clinician') });

  test('clinician sees Home + Patients but not Administration', async ({ page }) => {
    await page.goto('/home');
    await expect(page.getByRole('link', { name: /^home$/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /^patients$/i }).first()).toBeVisible();
    // Clinician (no admin role, no platformRole=PLATFORM_OWNER) must
    // NOT see Administration. Negative assertion — be careful about
    // false-positives if the link is just hidden behind a hover menu.
    await expect(
      page.getByRole('link', { name: /^administration$/i }),
    ).toHaveCount(0);
  });
});
