import { expect, test, type Locator, type Page } from '@playwright/test';

import { authStatePath } from './fixtures/seeded-users';

/**
 * A hard navigation issued microseconds after a mutation can out-run the
 * commit's visibility on the destination's first server render (these
 * `/owner/*` pages are `force-dynamic` and query Postgres directly). A human
 * reaches these screens via the nav seconds later — long after the commit is
 * visible — so this is a test-speed artifact, not a product bug. Reload the
 * page until the expected row shows up.
 */
async function expectVisibleWithReload(page: Page, locator: Locator, timeout = 20_000) {
  await expect(async () => {
    await page.reload();
    await expect(locator).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout });
}

/**
 * Owner deleted-data recovery surface (/owner/deleted-data).
 *
 *  1. Listing (read-only) — the platform owner sees the seeded soft-deleted
 *     organization AND the seeded soft-deleted user, with the user's original
 *     identity reconstituted from the owner-only recovery ledger.
 *  2. Round-trip — the owner deletes a disposable org, finds it in the
 *     deleted-data archive, restores it, and confirms it returns to the
 *     normal /owner/orgs surface. Disposable org per run → retry-safe; the
 *     seeded fixtures are only read, never consumed.
 */

test.describe('Owner deleted-data — listing + restore', () => {
  test.use({ storageState: authStatePath('owner') });

  test('lists the seeded soft-deleted org and the ledger-recovered user', async ({ page }) => {
    await page.goto('/owner/deleted-data');
    await expect(page.getByRole('heading', { name: /deleted data/i })).toBeVisible({
      timeout: 10_000,
    });

    // Organizations tab (default): seeded archived org is present + restorable.
    const orgsPanel = page.getByTestId('deleted-orgs-panel');
    await expect(orgsPanel).toBeVisible();
    await expect(orgsPanel.getByText('Archived Org (deleted)')).toBeVisible();
    await expect(page.getByTestId('restore-org-seed-deleted-org')).toBeVisible();

    // Users tab: the live row is anonymized, but the recovery ledger lets the
    // owner see the original email — and the row is restorable.
    await page.getByTestId('deleted-tab-users').click();
    const usersPanel = page.getByTestId('deleted-users-panel');
    await expect(usersPanel).toBeVisible();
    await expect(usersPanel.getByText('jane.archived@demo.local')).toBeVisible();
    await expect(page.getByTestId('restore-user-seed-deleted-user')).toBeVisible();
  });

  test('owner deletes a disposable org then restores it from the archive', async ({ page }) => {
    const suffix = Date.now().toString();
    const token = `E2E-DEL-${suffix}`;
    const orgName = `${token} Clinic`;
    const tokenRe = new RegExp(token);

    // --- create a disposable org via the New Organization form ---
    await page.goto('/owner/orgs/new');
    await page.getByLabel(/organization name/i).fill(orgName);
    await page.getByLabel(/billing email/i).fill(`del-${suffix}@e2e.local`);
    await page.getByLabel(/executed at/i).fill('2026-05-01');
    await page.getByLabel(/version/i).fill('2026.05.01');
    await page.getByLabel(/initial admin email/i).fill(`del-admin-${suffix}@e2e.local`);
    await page.getByRole('button', { name: /^create organization$/i }).click();

    // Redirects to the new org's detail page — confirms creation succeeded.
    await expect(page.getByRole('heading', { name: tokenRe })).toBeVisible({ timeout: 15_000 });

    // --- soft-delete it from the orgs list ---
    await page.goto('/owner/orgs');
    await page.getByRole('button', { name: new RegExp(`Delete organization ${token}`) }).click();
    const deleteDialog = page.getByRole('alertdialog');
    await expect(deleteDialog).toBeVisible();
    await Promise.all([
      page.waitForResponse((res) =>
        res.url().includes('/api/owner/orgs/') &&
        res.request().method() === 'DELETE' &&
        res.status() === 200,
      ),
      deleteDialog.getByRole('button', { name: /^delete$/i }).click(),
    ]);

    // It leaves the active orgs list…
    await expect(page.getByRole('link', { name: tokenRe })).toHaveCount(0);

    // --- find it in the deleted-data archive and restore it ---
    await page.goto('/owner/deleted-data');
    const orgsPanel = page.getByTestId('deleted-orgs-panel');
    const archivedRow = orgsPanel.getByRole('row', { name: tokenRe });
    await expectVisibleWithReload(page, archivedRow);
    await archivedRow.getByRole('button', { name: /restore/i }).click();

    const restoreDialog = page.getByRole('alertdialog');
    await expect(restoreDialog).toBeVisible();
    await Promise.all([
      page.waitForResponse((res) =>
        res.url().includes('/api/owner/orgs/') &&
        res.url().includes('/restore') &&
        res.request().method() === 'POST' &&
        res.status() === 200,
      ),
      restoreDialog.getByRole('button', { name: /^restore$/i }).click(),
    ]);

    // The row disappears from the archive…
    await expect(orgsPanel.getByRole('row', { name: tokenRe })).toHaveCount(0);

    // …and the org is back on the normal owner orgs surface.
    await page.goto('/owner/orgs');
    await expectVisibleWithReload(page, page.getByRole('link', { name: tokenRe }));
  });
});
