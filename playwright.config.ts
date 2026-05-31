import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Playwright config — end-to-end browser tests.
 *
 * Scope
 * -----
 * The Vitest suite (test/) covers ~1,144 unit + integration cases of
 * pure logic, route-handler request/response shapes, and component
 * rendering in jsdom. What it CAN'T cover is the multi-step browser
 * journey: login → land at /home → click through to a patient chart
 * → start a visit → land at /prepare with the right status. That's
 * what these specs are for.
 *
 * Decisions
 * ---------
 *  - Single browser (chromium-headless-shell). Cross-browser is
 *    valuable later; today's bottleneck is having e2e at all, so we
 *    keep the suite ~30s instead of 2 min.
 *  - `webServer` reuses the existing dev server when one's running
 *    (the dev workflow), and starts a new one otherwise (CI / fresh
 *    clone). `reuseExistingServer: !CI` is the documented Playwright
 *    pattern.
 *  - `globalSetup` re-seeds the dev DB so each suite run starts from
 *    a known clinical corpus. Tests assert against seeded patients
 *    (Maria Alvarez, James Park, etc.) by name — the seed is the
 *    source of truth for IDs.
 *  - Auth state (NextAuth cookies) is captured once per role in
 *    globalSetup and reused via `storageState`. Sign-in is the
 *    slowest single step in the suite; doing it once cuts ~5s off
 *    every spec.
 *  - Tests are assumed safe to RUN against the dev DB (they only
 *    create encounters/notes that get cleaned by the next
 *    `npx prisma db seed`). They never sign anything (rule 3) and
 *    never delete patients.
 */

const PORT = process.env.E2E_PORT ?? '3000';
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const SKIP_WEB_SERVER = process.env.PLAYWRIGHT_SKIP_WEBSERVER === '1';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  // Don't fail the whole suite on flake while we're stabilizing.
  retries: process.env.CI ? 2 : 1,
  // Spec files within the suite share the dev DB / seed corpus, so
  // running them sequentially per worker avoids cross-test data
  // pollution. Two workers is a sensible balance: each spec gets
  // its own browser context but they don't fight over the same
  // patient row.
  workers: process.env.CI ? 1 : 2,
  // Per-test timeout. Page renders are <1s in dev; visit creation
  // can hit ~5s due to the encounters POST + redirect; 30s is
  // comfortable headroom.
  timeout: 30_000,
  expect: {
    // Default 5s is too tight for SSE-driven UI. 10s gives /processing
    // and /review enough room to settle.
    timeout: 10_000,
  },
  reporter: process.env.CI ? 'github' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    // Capture trace + screenshot on the FIRST failure of a flake
    // (retry 1+); rapid-debug locally without slowing the happy path.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Headless by default. Override with `--headed` when debugging.
    // navigationTimeout — the longest single-page navigation we
    // expect: dev-mode /processing → /review redirect, ~3s.
    navigationTimeout: 15_000,
    actionTimeout: 10_000,
    // Attribute that page-objects can use for stable selectors.
    testIdAttribute: 'data-testid',
  },
  globalSetup: resolve(__dirname, 'e2e/global-setup.ts'),
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: SKIP_WEB_SERVER
    ? undefined
    : {
        command: 'npm run dev',
        url: BASE_URL,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
