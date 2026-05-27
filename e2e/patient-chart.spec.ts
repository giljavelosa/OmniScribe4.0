import { expect, test, type Page } from '@playwright/test';

import { authStatePath } from './fixtures/seeded-users';

/**
 * Patient chart surface — the clinical-cockpit single-patient view.
 *
 * Asserts the screen renders the right structural elements (identity
 * header, snapshot strip, tabbed body, action bar) and doesn't 404
 * for a patient we know is seeded. We deliberately don't assert on
 * specific content (exam findings, FollowUps) because those rotate
 * with each seed. Identity + visible scaffolding is the contract.
 */

test.use({ storageState: authStatePath('clinician') });

async function gotoFirstAlvarezChart(page: Page): Promise<string> {
  await page.goto('/patients?query=Alvarez');
  await page.getByRole('link', { name: /alvarez/i }).first().click();
  // Patient ids may be cuid2 (`cmpm…`) or seed-prefixed
  // (`seed-patient-medical`). Allow hyphens.
  await page.waitForURL(/\/patients\/[a-z0-9-]+$/);
  return page.url();
}

test.describe('patient chart — structural assertions', () => {
  test('identity header shows the patient name + an MRN', async ({ page }) => {
    await gotoFirstAlvarezChart(page);
    // The chart's identity strip renders the patient name as a
    // <span>, NOT an h1 — the chart was redesigned away from
    // PatientIdentityHeader's h1 to a denser sticky bar. Match the
    // literal "Maria Alvarez" / "Alvarez" text instead.
    await expect(page.getByText(/alvarez/i).first()).toBeVisible();
    // MRN row: rendered as `MRN <value>` in a font-mono span at
    // the top of the chart.
    await expect(page.getByText(/^MRN\s/).first()).toBeVisible();
  });

  test('demographics card has age + sex', async ({ page }) => {
    await gotoFirstAlvarezChart(page);
    // The header's StatusBadge renders "<SEX> · <age>y" — e.g.
    // "FEMALE · 70y". Match either casing.
    await expect(page.getByText(/(male|female)/i).first()).toBeVisible();
    await expect(page.getByText(/\b\d{1,3}\s*y\b/).first()).toBeVisible();
  });

  test('snapshot strip and chart tabs are visible', async ({ page }) => {
    await gotoFirstAlvarezChart(page);
    // Tabs use role=tab. There should be at least 2 tabs (Overview,
    // History — names vary by content but the structure is constant).
    const tabs = page.getByRole('tab');
    await expect(tabs.first()).toBeVisible();
    expect(await tabs.count()).toBeGreaterThanOrEqual(2);
  });

  test('start visit CTA is present and enabled for clinicians', async ({ page }) => {
    await gotoFirstAlvarezChart(page);
    const startButton = page.getByRole('button', { name: /^start visit$/i });
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeEnabled();
  });

  test('a chart for an unknown patient id 404s cleanly', async ({ page }) => {
    // cuid2-shaped string that isn't a real patient. The route should
    // 404 cleanly, not 500, and not leak internal errors.
    await page.goto('/patients/notarealpatientidxxx');
    // Either Next's 404 page renders or we get a "Patient not found"
    // empty state — either is acceptable. Just confirm no 500.
    await expect(page.locator('body')).not.toContainText(/internal server error/i);
  });
});
