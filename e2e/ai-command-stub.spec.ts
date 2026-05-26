import { expect, test } from '@playwright/test';

import { authStatePath } from './fixtures/seeded-users';

/**
 * "Ask OmniScribe AI" home panel — verifies the panel is HONEST about
 * being a stub today.
 *
 * The clinician research thread on 2026-05-25 explicitly raised the
 * risk of users mistaking the home AI panel for Miss Cleo's full
 * agentic copilot. The component (`src/components/home/ai-command-panel.tsx`)
 * is a Wave 8 stub: it forwards queries to /patients?query=... and
 * shows "Full AI copilot arrives in a future update". This spec
 * locks in that contract — if a future PR turns the stub into a
 * real LLM caller without a corresponding clinical-safety review,
 * THIS spec breaks first and forces the conversation.
 */

test.use({ storageState: authStatePath('clinician') });

test.describe('home AI command panel — stub contract', () => {
  test('renders the "Ask OmniScribe AI" heading + the disclaimer', async ({ page }) => {
    await page.goto('/home');
    // Desktop variant: heading + suggestion list + disclaimer. The
    // mobile variant doesn't render an h2, so this assertion uniquely
    // targets the desktop block.
    await expect(
      page.getByRole('heading', { name: /ask omniscribe ai/i }),
    ).toBeVisible();
    // Disclaimer wording differs slightly between variants:
    //   desktop  "Full AI copilot & agentic features arrive in a future update."
    //   mobile   "Full AI copilot arrives in a future update."
    // The mobile element comes first in DOM order but is hidden via
    // `lg:hidden`; `.last()` targets the visible desktop disclaimer.
    await expect(
      page.getByText(/full ai copilot.*future update/i).last(),
    ).toBeVisible();
  });

  test('typing a name + clicking Ask routes to patient search (the stub behavior)', async ({ page }) => {
    await page.goto('/home');
    // The desktop input on the right-side AI panel. Mobile variant
    // uses a different placeholder ("Ask OmniScribe AI…") so this
    // selector uniquely targets the desktop one.
    await page.getByPlaceholder(/find patient, draft note/i).first().fill('Park');
    await page.getByRole('button', { name: /^ask$/i }).first().click();

    await page.waitForURL(/\/patients\?query=Park/);
    await expect(page.getByRole('link', { name: /park/i }).first()).toBeVisible();
  });

  test('the suggestion buttons route to /patients?query=… too', async ({ page }) => {
    await page.goto('/home');
    await page.getByRole('button', { name: /^find a patient$/i }).first().click();
    await page.waitForURL(/\/patients\?query=/);
  });
});
