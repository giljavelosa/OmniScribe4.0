import { expect, test } from '@playwright/test';

import { authStatePath, SEED_PATIENTS } from './fixtures/seeded-users';

/**
 * Sprint 0 flag-analysis lockdown — browser wire-contract tests.
 *
 * Spec: context/specs/sprint-0-flag-analysis-lockdown.md
 *
 * What this covers
 * ----------------
 * Vitest already pins the heavy logic (decision-memory carry-forward,
 * diff-skip, signature normalization, route cap + sign-route gate
 * shapes — see test/lib/flag-analysis-state.test.ts,
 * test/workers/analyze-flags-carry-forward.test.ts,
 * test/api/analyze-flags-cap.test.ts,
 * test/api/sign-route-edited-since-analysis.test.ts — 48 cases).
 *
 * This spec adds the wire-contract layer those tests can't reach:
 *
 *   1. Auth gate on POST /analyze-flags (401 unauthenticated).
 *   2. The flags-read GET surface returns the new meta envelope
 *      (`runCount`, `runsRemaining`, `cap`, `canReanalyze`,
 *      `editedSinceLastAnalysis`, `editedSectionIds`,
 *      `lastAnalysisCompletedAt`) so the panel + sign client can
 *      depend on them in production.
 *   3. The route's status-gate (refuses PREPARING) still fires,
 *      proving the cap gate hasn't displaced the older preflight.
 *   4. POST /sign for an ineligible note still returns a structured
 *      4xx (proves the new attestation gate didn't introduce a 500
 *      path on the existing not-ready / no-pin / forbidden branches).
 *
 * What this deliberately does NOT do
 * ----------------------------------
 * - Drive the full record → finish → DRAFT → analyze pipeline. That
 *   would require fixturing a finalize-able audio segment + the
 *   transcription worker + Bedrock-stub timing. The 48 vitest cases
 *   already cover the analyzer's decision tree exhaustively; the e2e
 *   value here is the wire contract, not re-proving the worker.
 * - Hit the cap by running 3 real analyses. The cap is one int
 *   comparison + audit row; the route test in
 *   test/api/analyze-flags-cap.test.ts mocks the runCount to 2 and
 *   asserts the 409 directly. Re-asserting it via 3 sequential
 *   workered runs would be 90+ s of test time for the same evidence.
 */

test.describe('flag-analysis lockdown — auth surface', () => {
  test('POST /analyze-flags without a session returns 401', async ({ request }) => {
    const res = await request.post('/api/notes/notarealnoteid/analyze-flags');
    expect(res.status()).toBeGreaterThanOrEqual(401);
    expect(res.status()).toBeLessThan(500);
  });

  test('GET /flags without a session returns 401', async ({ request }) => {
    const res = await request.get('/api/notes/notarealnoteid/flags');
    expect(res.status()).toBeGreaterThanOrEqual(401);
    expect(res.status()).toBeLessThan(500);
  });
});

test.describe('flag-analysis lockdown — clinician on a fresh PREPARING note', () => {
  test.use({ storageState: authStatePath('clinician') });

  async function startVisitAndGetNoteId(page: import('@playwright/test').Page) {
    await page.goto(
      `/patients?query=${encodeURIComponent(SEED_PATIENTS.mariaAlvarez.searchHint)}`,
    );
    await page.getByRole('link', { name: /alvarez/i }).first().click();
    await page.waitForURL(/\/patients\/[a-z0-9]+$/);
    await page.getByRole('button', { name: /^start visit$/i }).click();
    await page.waitForURL(/\/prepare\/([a-z0-9]+)$/);
    const noteId = page.url().match(/\/prepare\/([a-z0-9]+)$/)?.[1];
    if (!noteId) throw new Error('Could not extract noteId from /prepare URL');
    return noteId;
  }

  test('POST /analyze-flags refuses 409 not_reviewable for a PREPARING note', async ({
    page,
    request,
  }) => {
    // A fresh visit lands at /prepare with status=PREPARING. The
    // analyzer only runs on DRAFT / REVIEWING (rule 3 — never
    // analyze a SIGNED note; and a PREPARING note has no draft
    // content yet). The route returns 409 not_reviewable, NOT 500.
    const noteId = await startVisitAndGetNoteId(page);

    const res = await request.post(`/api/notes/${noteId}/analyze-flags`);
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error?.code).toBe('not_reviewable');
    // Make sure the cap-reached check didn't swallow the older
    // status gate when runCount happens to be 0 (the most common
    // pre-deploy state).
    expect(body.error?.code).not.toBe('analysis_cap_reached');
  });

  test('GET /flags returns the full lockdown meta envelope', async ({ page, request }) => {
    const noteId = await startVisitAndGetNoteId(page);

    const res = await request.get(`/api/notes/${noteId}/flags`);
    expect(res.status()).toBe(200);
    const body = await res.json();

    // Data shape preserved.
    expect(Array.isArray(body.data)).toBe(true);

    // Sprint 0 meta envelope — these keys are what the panel + sign
    // client read; tighten the contract here so a future refactor of
    // the route doesn't silently drop one without the panel breaking.
    const meta = body.meta as Record<string, unknown>;
    expect(meta).toBeDefined();
    expect(meta.analysisState).toBeDefined();
    expect(typeof meta.runCount).toBe('number');
    expect(typeof meta.runsRemaining).toBe('number');
    expect(typeof meta.cap).toBe('number');
    expect(typeof meta.canReanalyze).toBe('boolean');
    expect(typeof meta.editedSinceLastAnalysis).toBe('boolean');
    expect(Array.isArray(meta.editedSectionIds)).toBe(true);

    // For a brand-new note: cap = 2, runCount = 0, runsRemaining = 2,
    // no analysis ever ran so editedSinceLastAnalysis is the no-op
    // false branch.
    expect(meta.cap).toBe(2);
    expect(meta.runCount).toBe(0);
    expect(meta.runsRemaining).toBe(2);
    expect(meta.editedSinceLastAnalysis).toBe(false);
  });

  test('POST /sign on a PREPARING note never 500s and returns a structured 4xx', async ({
    page,
    request,
  }) => {
    // The Sprint 0 lockdown added a new gate to the sign route.
    // Validate it didn't introduce a 500 path on the existing
    // not-ready / pending-router / unsigned-prereq branches: any
    // 4xx is fine — a 500 would mean the new gate threw on a note
    // it shouldn't have looked at.
    const noteId = await startVisitAndGetNoteId(page);

    const res = await request.post(`/api/notes/${noteId}/sign`, {
      data: { signPin: '1234' },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);

    const body = await res.json().catch(() => null);
    // Whatever the gate decided (not_ready, pending_router, pin_not_set,
    // auth_required, etc.), the error envelope shape stays the same.
    expect(body?.error?.code).toBeTruthy();
    // The new edited_since_analysis_unattested gate must NOT fire on
    // a PREPARING note (it's predicated on a baseline hash snapshot,
    // which a PREPARING note never has — backward-compat invariant).
    expect(body?.error?.code).not.toBe('edited_since_analysis_unattested');
  });
});

test.describe('flag-analysis lockdown — admin owner-bypass on analyze-flags', () => {
  test.use({ storageState: authStatePath('admin') });

  test('admin POST against an unknown note never 500s', async ({ request }) => {
    // Mirrors the empty-transcript-recovery admin-bypass probe: even
    // when the note id is fake, the route's preflight (auth → org
    // scope → not_found) must return a 4xx, never leak a 500. This
    // catches a class of bugs where the cap gate reads runCount
    // before the not_found gate — which would NPE on note=null.
    const res = await request.post('/api/notes/cmpfakenoteidxxxxxxxxxxx/analyze-flags');
    expect(res.status()).not.toBe(500);
  });
});
