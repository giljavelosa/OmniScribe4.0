import { expect, test, type Page } from '@playwright/test';

import { authStatePath } from './fixtures/seeded-users';

/**
 * Admin module — broad smoke coverage.
 *
 * Scope
 * -----
 * Proves each of the 9 admin-shell routes (a) RENDERS for ORG_ADMIN
 * (server-side query path doesn't 500, layout doesn't redirect away,
 * primary heading shows), and (b) IS GATED for non-admin roles +
 * unauthenticated callers (layout-level `redirect('/home')` /
 * `redirect('/login')`). Also asserts a small set of "seeded data
 * actually appears" anchors for the surfaces where the absence of
 * data would be the user-visible failure mode.
 *
 * Not in scope
 * ------------
 * - CRUD flows (covered by per-surface vitest authz suites + targeted
 *   route handler tests; e.g. `test/api/admin-templates-authz.test.ts`,
 *   `test/api/admin-user-sites.test.ts`).
 * - Stripe / billing happy paths (touch real Stripe sandbox; covered
 *   by `scripts/check-stripe-prod.ts` + `test/api/health-stripe.test.ts`).
 * - FHIR OAuth handshake (covered by the F1/F2/F3 unit suites).
 *
 * Why no per-route 401 from the API surface (mirroring the pattern
 * recording-lock.spec.ts uses)?
 * ---------------------------------------------------------------------
 * The 9 routes here are RSC pages, not API endpoints — auth is
 * enforced by the (admin) layout (`redirect('/login')` /
 * `redirect('/home')`). The API routes that BACK these pages are
 * separately authz-tested at the vitest layer. Driving the layout
 * via the browser is the right e2e shape; probing them via
 * page.request would just measure NextAuth's redirect chain, not the
 * gate we care about.
 */

const ADMIN_ROUTES = [
  { path: '/admin/users', heading: /^Users$/ },
  { path: '/admin/sites', heading: /^Sites$/ },
  { path: '/admin/seats', heading: /^Seats$/ },
  { path: '/admin/templates', heading: /^Templates$/ },
  { path: '/admin/audit', heading: /^Audit log$/ },
  { path: '/admin/ai-queries', heading: /Ask OmniScribe AI/ },
  { path: '/admin/integrations/fhir', heading: /EHR|Integration|FHIR/i },
  { path: '/admin/org-settings', heading: /^Org settings$/ },
  { path: '/admin/billing', heading: /^Billing$/ },
] as const;

/**
 * Adds a `?cb=<rand>` query param to defeat back-forward cache when
 * the same page object navigates from a redirected URL (e.g., /home)
 * back into an admin URL between tests in the same `test.describe`.
 * Without it, Playwright's reuse occasionally serves a cached /home
 * render even though the URL bar reads /admin/…
 */
function freshUrl(path: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}_e2e=${Math.random().toString(36).slice(2, 8)}`;
}

async function expectRedirectedTo(page: Page, route: string, expectedPath: RegExp) {
  // Use `commit` instead of the default `load` — the layout-level
  // redirect happens during SSR, so the FIRST committed URL is
  // already the post-redirect target. Avoids a race where the page
  // briefly shows /admin/… in the URL bar before the redirect
  // resolves and confuses `expect(page).toHaveURL`.
  await page.goto(freshUrl(route), { waitUntil: 'commit' });
  await expect(page).toHaveURL(expectedPath, { timeout: 10_000 });
}

// =============================================================================
// 1. ORG_ADMIN happy path — each route renders + primary heading visible.
// =============================================================================
test.describe('admin module — ORG_ADMIN renders every surface', () => {
  test.use({ storageState: authStatePath('admin') });

  for (const { path, heading } of ADMIN_ROUTES) {
    test(`GET ${path} renders + heading "${heading.source}" visible`, async ({ page }) => {
      const responses: Array<{ url: string; status: number }> = [];
      page.on('response', (res) => {
        if (new URL(res.url()).pathname === path) {
          responses.push({ url: res.url(), status: res.status() });
        }
      });

      await page.goto(freshUrl(path));

      // We stay on the requested route (no layout redirect).
      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/')));

      // The route's SSR response itself is 200 (catches a class of
      // bugs where the layout passes but the page throws server-side
      // and Next dev returns the error overlay HTML).
      const docResponse = responses.find((r) => r.url.includes(path));
      if (docResponse) {
        expect(docResponse.status).toBeLessThan(400);
      }

      // Primary heading rendered (proves the page reached return JSX,
      // not the Next.js error boundary).
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    });
  }
});

// =============================================================================
// 2. CLINICIAN is redirected to /home — layout-level role gate.
// =============================================================================
test.describe('admin module — CLINICIAN is redirected to /home', () => {
  test.use({ storageState: authStatePath('clinician') });

  for (const { path } of ADMIN_ROUTES) {
    test(`GET ${path} as CLINICIAN redirects to /home`, async ({ page }) => {
      await expectRedirectedTo(page, path, /\/home$/);
    });
  }
});

// =============================================================================
// 3. VIEWER is redirected to /home — same gate, different role.
// =============================================================================
test.describe('admin module — VIEWER is redirected to /home', () => {
  test.use({ storageState: authStatePath('viewer') });

  for (const { path } of ADMIN_ROUTES) {
    test(`GET ${path} as VIEWER redirects to /home`, async ({ page }) => {
      await expectRedirectedTo(page, path, /\/home$/);
    });
  }
});

// =============================================================================
// 4. Unauthenticated callers redirect to /login (NextAuth middleware).
// =============================================================================
test.describe('admin module — unauthenticated redirects to /login', () => {
  // Deliberately no storageState — fresh anonymous browser context.

  for (const { path } of ADMIN_ROUTES) {
    test(`GET ${path} unauthenticated redirects to /login`, async ({ page }) => {
      await expectRedirectedTo(page, path, /\/login/);
    });
  }
});

// =============================================================================
// 5. Key seeded data appears — the surfaces where empty-looking
//    rendering is the realistic regression mode.
// =============================================================================
test.describe('admin module — seeded data anchors', () => {
  test.use({ storageState: authStatePath('admin') });

  test('/admin/users lists the seeded clinician (clinician@demo.local)', async ({ page }) => {
    await page.goto(freshUrl('/admin/users'));
    // The page renders a `{N} members` card heading + a table of
    // rows; we don't lock the table-row markup, just assert the
    // email string appears somewhere in the rendered body.
    await expect(page.getByText('clinician@demo.local').first()).toBeVisible();
  });

  test('/admin/sites lists the seeded Demo Main Office site', async ({ page }) => {
    await page.goto(freshUrl('/admin/sites'));
    await expect(page.getByText(/Demo Main Office/i).first()).toBeVisible();
  });

  test('/admin/templates lists at least one preset template', async ({ page }) => {
    await page.goto(freshUrl('/admin/templates'));
    // Seeded presets show under a "Platform presets" card. shadcn's
    // <CardTitle> is a div (not a semantic heading), so we assert
    // the text directly. If the templates query 500s or returns []
    // for presets, this fails.
    await expect(page.getByText(/Platform presets/i).first()).toBeVisible();
  });

  test('/admin/audit renders the audit log heading + at least one row', async ({ page }) => {
    await page.goto(freshUrl('/admin/audit'));
    await expect(page.getByRole('heading', { name: /Audit log/i, level: 1 })).toBeVisible();
    // The seed leaves dozens of audit rows (org create, invites, etc.)
    // — assert at least one action chip is visible. The page renders
    // each action as monospace text inside a list row.
    await expect(page.locator('main').getByText(/USER_|ORG_|TEMPLATE_|PATIENT_/).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
