import { expect, test } from '@playwright/test';

import { authStatePath } from './fixtures/seeded-users';

/**
 * Owner org People card — verifies the platform owner can identify the
 * org admin, site admins, and clinicians for a given org at a glance.
 *
 * Companion to the Seats card update (assigned user's role now renders
 * as a colored pill instead of only the seat tier).
 */

test.describe('Owner org page — People + Seats role visibility', () => {
  test.use({ storageState: authStatePath('owner') });

  test.beforeEach(async ({ page }) => {
    await page.goto('/owner/orgs/seed-demo-clinic');
    await expect(page.getByRole('heading', { name: /demo clinic/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('People card lists members grouped by role with org/site admin pills', async ({ page }) => {
    const peopleCard = page.locator('div', { hasText: /^People$/ }).first();
    await expect(peopleCard.first()).toBeVisible({ timeout: 10_000 });

    // Header summary includes a count pill for each represented role.
    await expect(page.getByText(/\d+ members?/).first()).toBeVisible();

    // The table has one Org admin row and at least one Site admin row.
    const peopleSection = page.locator('section, div').filter({ has: page.getByRole('cell', { name: /^Org admin$/ }) }).first();
    await expect(peopleSection).toBeVisible();

    // Role labels render at least once each (org has an admin and a site admin in seed).
    await expect(page.getByRole('cell', { name: /^Org admin$/ })).toHaveCount(1);
    await expect(page.getByRole('cell', { name: /^Site admin$/ }).first()).toBeVisible();

    // The seeded org admin email is `admin@demo.local`.
    const adminRow = page.getByRole('row', { name: /admin@demo\.local/ }).first();
    await expect(adminRow).toBeVisible();
    await expect(adminRow.getByText('Org admin')).toBeVisible();
    await expect(adminRow.getByText('All sites')).toBeVisible();
  });

  test('Seats card now shows a role pill alongside the assigned email', async ({ page }) => {
    // CardTitle renders as a div, not an <h*>, so query by data-slot.
    const seatsCard = page
      .locator('[data-slot="card"]')
      .filter({ has: page.locator('[data-slot="card-title"]', { hasText: 'Seats' }) });
    await expect(seatsCard).toBeVisible({ timeout: 10_000 });
    await expect(seatsCard.getByText(/\d+ total · \d+ assigned/)).toBeVisible({
      timeout: 10_000,
    });

    // The org admin's seat row should carry the "Org admin" pill, not
    // just the tier — proving the surface answers "who runs this org?".
    const adminSeatRow = seatsCard.locator('li').filter({ hasText: 'admin@demo.local' }).first();
    await expect(adminSeatRow).toBeVisible();
    await expect(adminSeatRow.getByText('Org admin')).toBeVisible();
    // Tier still visible as the small uppercase chip on the right.
    await expect(adminSeatRow.getByText(/^TEAM$/)).toBeVisible();
  });
});
