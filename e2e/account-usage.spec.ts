import { expect, test } from '@playwright/test';

import { authStatePath } from './fixtures/seeded-users';

/**
 * Account usage — the customer-facing surface for the BillingPlan
 * tier rollout.
 *
 * What we lock in here:
 *   1. The DraftUsagePill is rendered on /home (mobile + desktop) and
 *      links to /account/usage.
 *   2. The "Usage" entry exists in the AppNav clinical group.
 *   3. /account/usage renders without errors for a signed-in clinician.
 *   4. The page contains the structural elements (drafts count,
 *      effective cost, monthly history).
 *
 * The detailed counter math is covered by Vitest unit tests
 * (test/components/draft-usage-pill.test.tsx + test/lib/*billing*.ts).
 * This spec proves the discoverability + page-render contract end-to-
 * end against the real DB.
 */

test.use({ storageState: authStatePath('clinician') });

test.describe('Usage — discoverability from /home', () => {
  test('home page shows a draft-usage pill linking to /account/usage', async ({ page }) => {
    await page.goto('/home');
    // Pill is an <a> with href="/account/usage". The icon-then-numbers
    // layout means we look for the link by aria-label.
    const pill = page.getByRole('link', {
      name: /drafts.*this month|drafts used this month/i,
    });
    await expect(pill.first()).toBeVisible();
    await expect(pill.first()).toHaveAttribute('href', '/account/usage');
  });

  test('clicking the pill navigates to /account/usage', async ({ page }) => {
    await page.goto('/home');
    await page
      .getByRole('link', { name: /drafts.*this month|drafts used this month/i })
      .first()
      .click();
    await page.waitForURL('**/account/usage');
    await expect(page).toHaveURL(/\/account\/usage$/);
  });

  test('AppNav exposes a "Usage" link in the clinical group', async ({ page }) => {
    await page.goto('/home');
    // Desktop AppNav renders one Usage link with role=link and the
    // Gauge icon. Mobile bottom nav doesn't include it (Patients is
    // the only mobile clinical link); desktop is what's covered.
    const navUsage = page.getByRole('link', { name: /^Usage$/ });
    await expect(navUsage.first()).toBeVisible();
    await expect(navUsage.first()).toHaveAttribute('href', '/account/usage');
  });
});

test.describe('Usage — page renders', () => {
  test('GET /account/usage shows the structural content', async ({ page }) => {
    await page.goto('/account/usage');
    await expect(page).toHaveURL(/\/account\/usage$/);
    // Page heading is a real <h1>.
    await expect(page.getByRole('heading', { name: /^usage$/i })).toBeVisible();
    // CardTitles render as <div> (not heading). Match by text.
    await expect(page.getByText('This period', { exact: true })).toBeVisible();
    await expect(page.getByText('Effective cost', { exact: true })).toBeVisible();
    await expect(page.getByText('Last 6 months', { exact: true })).toBeVisible();
  });

  // Note: auth-gate redirect coverage for /account/* is identical to the
  // existing `auth.spec.ts` tests for /home and /admin/users (they all
  // share the same `(clinical)` layout's auth check). Not duplicated here.
});
