# End-to-end browser tests (Playwright)

These specs exercise the full clinical-cockpit stack the way a
clinician does: real Next.js dev server, real Postgres + Redis,
real NextAuth cookies, real Prisma queries. They catch regressions
the Vitest suite can't see — login flow, route gating, the profile
gate, the start-visit dialog, etc.

## Quickstart

```bash
# One-time: install the chromium binary
npm run e2e:install

# Run the full suite headlessly (assumes dev DB + Redis are up)
npm run e2e

# Open Playwright's interactive runner (best for debugging)
npm run e2e:ui

# Re-watch a single spec live (headed Chromium)
npx playwright test e2e/start-visit.spec.ts --headed

# After a failure, open the HTML report
npm run e2e:report
```

## What the suite covers

| Spec | Scope |
|---|---|
| `auth.spec.ts` | Sign-in form happy path, bad-password rejection, account-enumeration prevention, protected-route redirects, storageState reuse |
| `profile-completion-gate.spec.ts` | Admin bypass, viewer bypass, clinician-with-profession passes — locks in the fix from commit `8d02880` |
| `patient-search.spec.ts` | Home → search → patients list → chart navigation; AppNav role gating (admin sees Administration, clinician doesn't) |
| `patient-chart.spec.ts` | Identity header, demographics, snapshot strip, chart tabs, Start visit CTA presence |
| `start-visit.spec.ts` | Start visit auto-post → /prepare/[noteId]; chevron menu → Start late entry |
| `late-entry.spec.ts` | 30-day backdating window: today preselected, 5-days-back banner, future-date rejected, > 30-days rejected, happy-path POST |
| `empty-transcript-recovery.spec.ts` | reset-recording API auth/ownership/content-guard contracts (covers the 2026-05-25 silent-recording fix) |
| `ai-command-stub.spec.ts` | The home AI panel is honestly labelled as a stub and forwards to /patients?query=… (locks in Wave 8 contract) |

## How globalSetup works

Before the suite runs, `e2e/global-setup.ts`:

1. Re-seeds the dev database (`npx prisma db seed`). The dev DB is
   the source of truth for Maria Alvarez, James Park, Devon Mitchell,
   admin@demo.local, clinician@demo.local, etc.
2. Signs in once per role (admin / clinician / viewer / owner) and
   writes the resulting NextAuth cookie to `e2e/.auth/<role>.json`.
3. Specs declare `test.use({ storageState: authStatePath('admin') })`
   to reuse those cookies — no per-spec sign-in roundtrip.

To skip the reseed (faster local iteration):

```bash
E2E_SKIP_RESEED=1 npm run e2e
```

## Required services

The suite is a true full-stack smoke. You need **all of these**
running before `npm run e2e`:

- Postgres (the `DATABASE_URL` in `.env`)
- Redis (the `REDIS_URL` in `.env`)
- `npm run dev` (the suite reuses the existing dev server when
  available; otherwise starts one — see `playwright.config.ts`
  `webServer` block)

Workers are NOT required for these specs — none of the assertions
depend on a worker round-trip. (We deliberately stop at /prepare
mounting; we don't capture audio or sign notes in e2e because both
require infrastructure we can't fake in a browser.)

## What's NOT covered (intentionally)

- **Audio capture.** WebRTC + Soniox + the AudioWorklet chain
  isn't reasonable to mock in a browser e2e. Unit tests cover the
  state machine; e2e stops at "the recording surface mounted".
- **Note signing.** Signing creates immutable `finalJson` rows
  (rule 3) + audit log entries. We don't manufacture those in e2e;
  the route handler has unit + integration coverage.
- **Cross-org isolation.** Covered exhaustively by the
  `test/api/*-authz.test.ts` Vitest suite at the route-handler
  layer. E2e adds little there.
- **Mobile viewport.** The whole suite runs against
  `devices['Desktop Chrome']`. A future PR can add a `mobile` project
  that re-runs critical specs against the iPhone profile.

## Adding a new spec

1. Decide which seeded role you need; declare `test.use({ storageState: authStatePath('<role>') })`.
2. Use the page-objects in `e2e/helpers/pages.ts` for stable
   selectors. If you need a new one, add it to the helper file
   so other specs can reuse it.
3. Reference seeded patients via `SEED_PATIENTS` (in
   `e2e/fixtures/seeded-users.ts`) — never hard-code patient IDs.
4. Run the spec headed first (`--headed`) to verify your selectors;
   then headless to confirm timing.

## Troubleshooting

**"All specs hang on sign-in / never reach /home."**
The dev server isn't responding fast enough. Check it's running and
healthy first; `globalSetup` will time out after 120s.

**"Login fails with `Invalid email or password`."**
Run `npx prisma db seed` manually first — the seed defines the
demo users and the suite's globalSetup re-runs it, but if your DB
was wiped between runs it can be flaky on the first execution.

**"A patient row I expected isn't visible."**
The seed re-runs deterministically; if you've deleted seeded patients
manually you'll need to reseed. Set `E2E_SKIP_RESEED=0` (default) for
the next run.
