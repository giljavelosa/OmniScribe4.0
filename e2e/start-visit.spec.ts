import { expect, test } from '@playwright/test';

import { authStatePath, SEED_PATIENTS } from './fixtures/seeded-users';

/**
 * Start visit — happy path
 * ------------------------
 * Clinician opens a chart, clicks "Start visit", and lands at
 * /prepare/[noteId] with a freshly-created encounter+note.
 *
 * Why this matters
 * ----------------
 * This is the first half of the most-frequent journey in the app
 * (Visit → Prepare → Capture → Review → Sign). If Start visit
 * regresses, EVERY downstream surface is unreachable. The unit/
 * integration suite covers the route handler, the dialog state
 * machine, and the redirect; this spec is the full-stack smoke.
 *
 * What it does NOT do
 * -------------------
 * - It doesn't capture audio. WebRTC + Soniox + the AudioWorklet
 *   chain isn't reasonable to mock in a browser e2e. We assert that
 *   /prepare loads with the right note status and stop there.
 * - It doesn't sign the note. Signing is exercised by the
 *   route-handler tests; doing it in e2e would create irreversible
 *   audit + finalJson rows and break rule 3 (signed notes immutable).
 *
 * Cleanup
 * -------
 * Each run creates an encounter + DRAFT note. They get GC'd by the
 * next `npx prisma db seed` (globalSetup). No per-test cleanup
 * needed; the seed corpus is source of truth.
 */

test.use({ storageState: authStatePath('clinician') });

async function openAlvarezChart(page: import('@playwright/test').Page) {
  await page.goto(`/patients?query=${encodeURIComponent(SEED_PATIENTS.mariaAlvarez.searchHint)}`);
  await page.getByRole('link', { name: /alvarez/i }).first().click();
  await page.waitForURL(/\/patients\/[a-z0-9-]+$/);
}

test.describe('start visit — happy path', () => {
  test('clinician → chart → Start visit → /prepare/[noteId] loads', async ({ page }) => {
    await openAlvarezChart(page);

    // The default "Start visit" path auto-posts (no episode picker)
    // because the seeded clinician is single-site and the patient
    // doesn't trigger the rehab episode picker for a MEDICAL clinician.
    await page.getByRole('button', { name: /^start visit$/i }).click();

    // After the silent POST resolves, router.push → /prepare/[noteId].
    // Patient/note ids may be cuid2 OR seed-prefixed; allow hyphens.
    await page.waitForURL(/\/prepare\/[a-z0-9-]+$/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/prepare\/[a-z0-9-]+$/);
  });

  test('the prepare page shows the patient identity', async ({ page }) => {
    await openAlvarezChart(page);
    await page.getByRole('button', { name: /^start visit$/i }).click();
    await page.waitForURL(/\/prepare\/[a-z0-9-]+$/);
    await expect(page.getByText(/alvarez/i).first()).toBeVisible();
  });

  test('the prepare page shows the recording CTA', async ({ page }) => {
    await openAlvarezChart(page);
    await page.getByRole('button', { name: /^start visit$/i }).click();
    await page.waitForURL(/\/prepare\/[a-z0-9-]+$/);

    // The /prepare LiveCaptureButton renders "Start recording"
    // (or "Checking mic…" while the mic preflight runs).
    const cta = page
      .getByRole('button', { name: /^(start recording|checking mic…)$/i })
      .first();
    await expect(cta).toBeVisible();
  });
});

test.describe('start visit — chevron menu surfaces late-entry', () => {
  test('chevron opens "Start late entry…" menuitem', async ({ page }) => {
    await openAlvarezChart(page);
    await page.getByRole('button', { name: /more visit options/i }).click();
    await expect(
      page.getByRole('menuitem', { name: /start late entry/i }),
    ).toBeVisible();
  });
});
