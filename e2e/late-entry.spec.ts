import { expect, test } from '@playwright/test';

import { authStatePath, SEED_PATIENTS } from './fixtures/seeded-users';

/**
 * Late entry — backdated visit creation.
 *
 * The dialog enforces a 30-day window (LATE_ENTRY_MAX_DAYS in
 * start-visit-dialog.tsx). Future dates are rejected client-side
 * with a status banner; > 30-day-old dates similarly. This spec
 * exercises both edges and the happy path.
 *
 * The "Start late entry" entry path always opens the picker shell
 * (forceDatePicker=true), even for 0/1-episode patients — that's
 * the design amendment fixed in spec § Goals.
 */

test.use({ storageState: authStatePath('clinician') });

function isoDate(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(0, 0, 0, 0);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function openLateEntryDialog(page: import('@playwright/test').Page) {
  await page.goto(`/patients?query=${encodeURIComponent(SEED_PATIENTS.mariaAlvarez.searchHint)}`);
  await page.getByRole('link', { name: /alvarez/i }).first().click();
  await page.waitForURL(/\/patients\/[a-z0-9-]+$/);
  await page.getByRole('button', { name: /more visit options/i }).click();
  await page.getByRole('menuitem', { name: /start late entry/i }).click();
  await expect(page.getByLabel(/visit date/i)).toBeVisible();
}

test.describe('late entry — picker shell', () => {
  test('the late-entry dialog opens with today preselected', async ({ page }) => {
    await openLateEntryDialog(page);
    const dateInput = page.getByLabel(/visit date/i);
    const value = await dateInput.inputValue();
    expect(value).toBe(isoDate(0));
  });

  test('backdating 5 days surfaces the late-entry banner', async ({ page }) => {
    await openLateEntryDialog(page);
    await page.getByLabel(/visit date/i).fill(isoDate(-5));
    await expect(
      page.getByText(/late entry — sign attestation will reflect this date/i),
    ).toBeVisible();
    // Submit button label flips to "Start late entry" when the date
    // is in the past.
    await expect(
      page.getByRole('button', { name: /^start late entry$/i }),
    ).toBeVisible();
  });

  test('a future date shows the danger banner and disables submit', async ({ page }) => {
    await openLateEntryDialog(page);
    await page.getByLabel(/visit date/i).fill(isoDate(+1));
    await expect(
      page.getByText(/visit date cannot be in the future/i),
    ).toBeVisible();

    // Submit must be disabled — clinician cannot proceed.
    const submit = page.getByRole('button', { name: /^(start visit|start late entry)$/i });
    await expect(submit).toBeDisabled();
  });

  test('beyond the 30-day window shows the danger banner and disables submit', async ({ page }) => {
    await openLateEntryDialog(page);
    await page.getByLabel(/visit date/i).fill(isoDate(-45));
    await expect(
      page.getByText(/visit date cannot be more than 30 days ago/i),
    ).toBeVisible();
    const submit = page.getByRole('button', { name: /^(start visit|start late entry)$/i });
    await expect(submit).toBeDisabled();
  });
});

test.describe('late entry — happy path', () => {
  test('backdating 3 days submits → /prepare with late-entry context', async ({ page }) => {
    await openLateEntryDialog(page);
    await page.getByLabel(/visit date/i).fill(isoDate(-3));
    await page.getByRole('button', { name: /^start late entry$/i }).click();

    await page.waitForURL(/\/prepare\/[a-z0-9-]+$/, { timeout: 15_000 });
    // The prepare page is now scoped to a backdated note. We don't
    // assert specific banner text because the layout for that
    // moves frequently — but we know the recording surface
    // mounted because the URL matches.
    await expect(page).toHaveURL(/\/prepare\/[a-z0-9-]+$/);
  });
});
