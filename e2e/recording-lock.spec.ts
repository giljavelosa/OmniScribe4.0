import { expect, test } from '@playwright/test';

import { authStatePath, SEED_PATIENTS } from './fixtures/seeded-users';

/**
 * Single-concurrent-recording lock — anti-credential-sharing defense.
 *
 * The full defense is documented in src/lib/recording-lock/claim.ts.
 * What we exercise here from the browser side:
 *
 *   1. A clinician's first /realtime-key call claims the lock and
 *      mints the Soniox key.
 *   2. A second /realtime-key call from the SAME signed-in user with
 *      a DIFFERENT clientNonce — simulating "the same account
 *      logged in on a second device" — gets 409 with
 *      `recording_locked` + meta describing the active lock.
 *   3. The same second call passing `takeover: true` succeeds and
 *      displaces the prior lock.
 *
 * The unit + Vitest layers cover the lock-helper logic + audit
 * metadata shape exhaustively; this spec proves the wire contract
 * the browser sees end-to-end (auth + Prisma + Soniox stub).
 *
 * NOTE: the lock is per-USER. Tests within this describe block all
 * use the same `clinician` storage state, so each test's initial
 * claim passes `takeover: true` to clear any leftover lock from a
 * prior test. The "claim wins" semantics are still proven inside
 * each test (the second-device-rejected branch).
 */

test.use({ storageState: authStatePath('clinician') });

const NONCE_DEVICE_A = 'e2e-device-a-' + Math.random().toString(36).slice(2, 12);
const NONCE_DEVICE_B = 'e2e-device-b-' + Math.random().toString(36).slice(2, 12);

async function startVisitAndGetNoteId(page: import('@playwright/test').Page) {
  await page.goto(`/patients?query=${encodeURIComponent(SEED_PATIENTS.mariaAlvarez.searchHint)}`);
  await page.getByRole('link', { name: /alvarez/i }).first().click();
  await page.waitForURL(/\/patients\/[a-z0-9-]+$/);
  await page.getByRole('button', { name: /^start visit$/i }).click();
  await page.waitForURL(/\/prepare\/([a-z0-9-]+)$/);
  const m = page.url().match(/\/prepare\/([a-z0-9-]+)$/);
  const noteId = m?.[1];
  if (!noteId) throw new Error('Could not extract noteId from /prepare URL');
  return noteId;
}

test.describe('recording-lock — claim + conflict + takeover (API surface)', () => {
  test('first device claims; second device gets 409; takeover succeeds; old device displaced', async ({ page, request }) => {
    const noteId = await startVisitAndGetNoteId(page);

    // 1. First device — `takeover:true` to claim a clean slate (covers
    //    any leftover lock from prior tests). The behavior under test
    //    (200 response + nonce echoed back) is identical whether the
    //    server's action ends up "claimed" or "takeover".
    const firstClaim = await request.post(`/api/notes/${noteId}/realtime-key`, {
      data: { clientNonce: NONCE_DEVICE_A, takeover: true },
    });
    expect(firstClaim.status()).toBe(200);
    expect((await firstClaim.json()).data?.clientNonce).toBe(NONCE_DEVICE_A);

    // 2. Second device with a DIFFERENT nonce, NO takeover — rejected
    //    because the first device's heartbeat is fresh.
    const conflict = await request.post(`/api/notes/${noteId}/realtime-key`, {
      data: { clientNonce: NONCE_DEVICE_B },
    });
    expect(conflict.status()).toBe(409);
    const conflictBody = await conflict.json();
    expect(conflictBody.error?.code).toBe('recording_locked');
    expect(conflictBody.meta?.activeNoteId).toBe(noteId);
    expect(typeof conflictBody.meta?.activeLockAgeMs).toBe('number');

    // 3. Second device with takeover=true — displaces the prior lock.
    const takeover = await request.post(`/api/notes/${noteId}/realtime-key`, {
      data: { clientNonce: NONCE_DEVICE_B, takeover: true },
    });
    expect(takeover.status()).toBe(200);
    expect((await takeover.json()).data?.clientNonce).toBe(NONCE_DEVICE_B);

    // 4. The previously-holding device's nonce is no longer valid —
    //    a re-mint with NONCE_DEVICE_A now goes through the rejection
    //    branch (the new lock is fresh and held by NONCE_DEVICE_B).
    const displaced = await request.post(`/api/notes/${noteId}/realtime-key`, {
      data: { clientNonce: NONCE_DEVICE_A },
    });
    expect(displaced.status()).toBe(409);
  });

  test('same-device re-mint is treated as a refresh (200, no conflict)', async ({ page, request }) => {
    const noteId = await startVisitAndGetNoteId(page);
    const NONCE = 'e2e-refresh-' + Math.random().toString(36).slice(2, 12);

    // takeover=true on the FIRST claim to guarantee we won the lock
    // regardless of prior test state. Subsequent same-nonce calls
    // exercise the refresh path (no takeover needed; the lock is ours).
    const first = await request.post(`/api/notes/${noteId}/realtime-key`, {
      data: { clientNonce: NONCE, takeover: true },
    });
    expect(first.status()).toBe(200);

    const second = await request.post(`/api/notes/${noteId}/realtime-key`, {
      data: { clientNonce: NONCE },
    });
    expect(second.status()).toBe(200);
    expect((await second.json()).data?.clientNonce).toBe(NONCE);
  });

  test('legacy POST without a clientNonce body falls back to a server-generated nonce', async ({ page, request }) => {
    const noteId = await startVisitAndGetNoteId(page);

    // Clear any leftover lock from the prior tests by claiming with a
    // fresh nonce + takeover, then RELEASE — there's no public release
    // endpoint, so we instead simulate a takeover from the legacy POST
    // path itself by passing only `takeover: true` in the body.
    // The contract: the server falls back to a generated nonce + still
    // supports takeover via the optional flag.
    const res = await request.post(`/api/notes/${noteId}/realtime-key`, {
      data: { takeover: true },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.data?.clientNonce).toBe('string');
    // Legacy nonces are server-generated and prefixed `legacy-`.
    expect(body.data.clientNonce).toMatch(/^legacy-/);
  });
});
