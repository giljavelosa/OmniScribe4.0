import { expect, test } from '@playwright/test';

import { authStatePath } from './fixtures/seeded-users';

/**
 * Org-admin team management (/admin/users) — deactivate then reactivate a
 * member of the admin's OWN org, and the active/deactivated separation.
 *
 * Drives the dedicated seeded member `deactivate-me@demo.local` and ends by
 * reactivating it, so the fixture returns to its starting state → retry-safe.
 */

const TARGET_EMAIL = 'deactivate-me@demo.local';
const targetRe = new RegExp(TARGET_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

test.describe('Admin users — deactivate / reactivate + status filter', () => {
  test.use({ storageState: authStatePath('admin') });

  test('admin deactivates a member (status filter follows) then reactivates', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: /^users$/i })).toBeVisible({ timeout: 10_000 });

    const row = page.getByRole('row', { name: targetRe });
    await expect(row).toBeVisible();
    await expect(row.getByText('active', { exact: true })).toBeVisible();

    // --- deactivate via the row actions menu + confirmation dialog ---
    await row.getByRole('button', { name: new RegExp(`Actions for ${TARGET_EMAIL}`) }).click();
    await page.getByRole('menuitem', { name: /^deactivate$/i }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    // Copy makes the seat consequence explicit.
    await expect(dialog).toContainText(/seat/i);
    await dialog.getByRole('button', { name: /^deactivate$/i }).click();

    // Row stays in the default (All) view but now reads deactivated.
    await expect(page.getByRole('row', { name: targetRe }).getByText('deactivated', { exact: true }))
      .toBeVisible({ timeout: 10_000 });

    // --- status filter cleanly separates the two cohorts ---
    await page.getByTestId('admin-users-filter-active').click();
    await expect(page.getByRole('row', { name: targetRe })).toHaveCount(0);

    await page.getByTestId('admin-users-filter-deactivated').click();
    await expect(page.getByRole('row', { name: targetRe })).toBeVisible();

    // --- reactivate (direct action, no dialog) ---
    await page
      .getByRole('row', { name: targetRe })
      .getByRole('button', { name: new RegExp(`Actions for ${TARGET_EMAIL}`) })
      .click();
    await page.getByRole('menuitem', { name: /^reactivate$/i }).click();

    // Back on the Active view it shows up again as active.
    await page.getByTestId('admin-users-filter-active').click();
    await expect(page.getByRole('row', { name: targetRe }).getByText('active', { exact: true }))
      .toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Admin users — clinician has no management surface', () => {
  test.use({ storageState: authStatePath('clinician') });

  test('a non-admin clinician cannot reach the team-management page', async ({ page }) => {
    await page.goto('/admin/users');
    // The org-admin-gated page must not render its team table for a clinician;
    // they are redirected away from /admin.
    await expect(page).not.toHaveURL(/\/admin\/users/, { timeout: 10_000 });
  });
});
