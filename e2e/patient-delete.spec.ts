import { expect, test } from '@playwright/test';

import { authStatePath } from './fixtures/seeded-users';

/**
 * Patient deletion — org-admin UI flow.
 *
 * Uses a disposable patient created through the real Add patient sheet so
 * seeded clinical patients are not touched. The delete itself must stay
 * behind the Profile-tab org-admin control and AlertDialog confirmation.
 */

test.describe('patient deletion — organization admin', () => {
  test.use({ storageState: authStatePath('admin') });

  test('org admin creates a disposable patient, deletes it, and it leaves active search', async ({ page }) => {
    const suffix = Date.now().toString();
    const firstName = 'Delete';
    const lastName = `E2E${suffix}`;
    const fullName = `${firstName} ${lastName}`;

    await page.goto('/patients');
    await page.getByRole('button', { name: /\+ add patient/i }).click();

    await page.getByLabel(/first name/i).fill(firstName);
    await page.getByLabel(/last name/i).fill(lastName);
    await page.getByLabel(/date of birth/i).fill('1970-01-15');
    await page.getByRole('button', { name: /^create patient$/i }).click();

    await page.waitForURL(/\/patients\/[a-z0-9-]+$/);
    await expect(page.getByText(fullName).first()).toBeVisible();

    await page.getByRole('tab', { name: /^profile$/i }).click();
    await expect(page.getByText(/organization admin controls/i)).toBeVisible();
    await page.getByRole('button', { name: /^delete patient record$/i }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`Delete ${fullName}?`);
    await dialog.getByRole('button', { name: /^delete patient record$/i }).click();

    await page.waitForURL(/\/patients$/);
    await page.goto(`/patients?query=${encodeURIComponent(lastName)}`);
    await expect(page.getByText(/no patients matching/i).last()).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(lastName, 'i') })).toHaveCount(0);
  });
});

test.describe('patient deletion — non-admin clinical user', () => {
  test.use({ storageState: authStatePath('clinician') });

  test('clinician does not see patient deletion controls', async ({ page }) => {
    await page.goto('/patients?query=Park');
    await page.getByRole('link', { name: /park/i }).first().click();
    await page.waitForURL(/\/patients\/[a-z0-9-]+$/);

    await page.getByRole('tab', { name: /^profile$/i }).click();

    await expect(page.getByText(/organization admin controls/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^delete patient record$/i })).toHaveCount(0);
  });
});
