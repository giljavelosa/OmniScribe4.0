import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

import { saveAuthState } from './fixtures/auth';

/**
 * Playwright global setup — runs once before the suite.
 *
 *  1. Re-seed the dev DB so each suite starts from a known clinical
 *     corpus. `npx prisma db seed` is idempotent; it upserts orgs,
 *     users, patients, and signed-visit corpora.
 *  2. Sign in once per role (admin, clinician, viewer, owner) and
 *     save the resulting NextAuth cookie to `e2e/.auth/<role>.json`.
 *     Specs reuse via `test.use({ storageState })`. Cuts ~5s per
 *     spec.
 *
 * The reseed can be skipped by setting `E2E_SKIP_RESEED=1` — useful
 * during a fast local-only iteration loop where you don't want to
 * lose drafts you just created in the dev DB.
 */
export default async function globalSetup(): Promise<void> {
  // ---------- Step 1: reseed (unless explicitly skipped) -------------
  if (process.env.E2E_SKIP_RESEED !== '1') {
    process.stdout.write('[e2e setup] re-seeding dev DB…\n');
    try {
      execSync('npx prisma db seed', {
        stdio: 'inherit',
        env: { ...process.env },
      });
    } catch (err) {
      // Don't fail the whole suite — many specs only need read-only
      // seeded data; the existing DB may be sufficient. Log + move on.
      process.stderr.write(
        `[e2e setup] seed failed (continuing with existing DB): ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
  } else {
    process.stdout.write('[e2e setup] E2E_SKIP_RESEED=1 → skipping reseed.\n');
  }

  // ---------- Step 2: sign in once per role -------------------------
  const authDir = 'e2e/.auth';
  if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    process.stdout.write(
      '[e2e setup] caching auth state for admin + clinician + viewer + owner + siteadmin + southadmin…\n',
    );
    await saveAuthState(browser, 'admin');
    await saveAuthState(browser, 'clinician');
    await saveAuthState(browser, 'viewer');
    await saveAuthState(browser, 'owner');
    await saveAuthState(browser, 'siteadmin');
    await saveAuthState(browser, 'southadmin');
    process.stdout.write('[e2e setup] auth state cached.\n');
  } finally {
    await browser.close();
  }
}
