import { expect, test, type Page } from '@playwright/test';

import { authStatePath, SEED_PATIENTS } from './fixtures/seeded-users';

/**
 * Sprint 0.14 — research-mode copilot conversation persistence.
 *
 * Regression lock for the Prisma findUnique(null patientId) crash:
 * RESEARCH conversations are patient-agnostic (patientId = null), so
 * hydration + first POST must return 200, not 500.
 */

test.use({ storageState: authStatePath('clinician') });

async function openPatientChartWithCopilot(page: Page): Promise<void> {
  await page.goto(`/patients?query=${SEED_PATIENTS.mariaAlvarez.searchHint}`);
  await page.getByRole('link', { name: /alvarez/i }).first().click();
  await page.waitForURL(/\/patients\/[a-z0-9-]+$/);
  // CopilotShell only mounts when the patient has at least one signed note.
  await expect(page.getByRole('button', { name: /open co-pilot/i })).toBeVisible();
}

async function openCopilotResearchTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: /open co-pilot/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('tab', { name: /^research$/i }).click();
  await expect(page.getByText(/research mode — patient-agnostic/i)).toBeVisible();
}

test.describe('copilot — research-mode conversation', () => {
  test('hydrates RESEARCH conversation without a 500', async ({ page }) => {
    const hydratePromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/copilot/conversations?mode=RESEARCH') &&
        res.request().method() === 'GET',
    );

    await openPatientChartWithCopilot(page);
    await openCopilotResearchTab(page);

    const hydrateRes = await hydratePromise;
    expect(hydrateRes.status()).toBe(200);

    await expect(page.getByText(/research failed \(500\)/i)).toHaveCount(0);
    await expect(
      page.getByPlaceholder(/ask about evidence in the literature/i),
    ).toBeVisible();
  });

  test('POST /api/copilot/research returns an assistant answer', async ({ page }) => {
    test.setTimeout(60_000);

    await openPatientChartWithCopilot(page);

    const hydratePromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/copilot/conversations?mode=RESEARCH') &&
        res.status() === 200,
    );
    await openCopilotResearchTab(page);
    await hydratePromise;

    const postPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/copilot/research') &&
        res.request().method() === 'POST',
    );

    const question = 'What is evidence-based fall prevention in older adults?';
    await page.getByPlaceholder(/ask about evidence in the literature/i).fill(question);
    await page.getByRole('button', { name: /^search$/i }).click();

    const postRes = await postPromise;
    expect(postRes.status()).toBe(200);

    await expect(page.getByText(/research failed/i)).toHaveCount(0);
    // RESEARCH conversations persist across runs (the seed doesn't clear them),
    // so this question can appear more than once — assert the just-posted bubble.
    await expect(page.getByText(question).last()).toBeVisible();
    await expect(page.getByText(/searching the literature/i)).toHaveCount(0, {
      timeout: 45_000,
    });
  });
});
