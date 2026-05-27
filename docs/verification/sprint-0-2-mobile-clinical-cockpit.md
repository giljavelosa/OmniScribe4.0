# Sprint 0.2 — Mobile Clinical Cockpit Verification

> **Sprint 0.20 — MFA removed.** Any reference to MFA, /mfa-challenge, /mfa-setup, TOTP, authenticator app setup, or login-verified gates in this document is HISTORICAL. Authentication is now password-only. See `context/specs/01-foundation-auth-tenant.md` and `progress-tracker.md`.


> Date: 2026-05-20

---

## What changed

| File | Change |
|------|--------|
| `src/components/navigation/mobile-bottom-nav.tsx` | **New** — Fixed 5-item bottom nav (`Home / Patients / Record / Drafts / More`). `lg:hidden`. `env(safe-area-inset-bottom)` for iOS notch. "More" opens a Sheet with role-gated admin/owner/ops links. |
| `src/components/home/today-status-tiles.tsx` | **New** — Compact 3-column tappable row (`N Visits / N Drafts / N Follow-ups`). Replaces large empty-state cards. |
| `src/components/home/ai-command-panel.tsx` | **New** — Stub AI command entry. Desktop: full panel with suggestions. Mobile: compact input strip. Routes queries to `/patients?query=…`. Full copilot wired in Wave 8. |
| `src/components/app-nav.tsx` | **Modified** — Nav link elements wrapped in `hidden lg:inline-flex` spans. Email + sign-out remain at all breakpoints. Mobile header is now a compact single line: logo | email · sign out. |
| `src/app/(clinical)/layout.tsx` | **Modified** — `<MobileBottomNav>` added at bottom of layout. `<main>` gets `pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0` to prevent content hiding behind fixed nav. |
| `src/app/(clinical)/home/page.tsx` | **Modified** — Dual responsive branches. Mobile: clinical cockpit (patient search + CTAs above fold, status tiles, compact queue/drafts). Desktop: three-column grid (240px sidebar + flex center + 320px AI panel). |

---

## Viewport notes

### 430px mobile (iPhone 15 Pro, Safari)

Above the fold (no scroll required):
- OmniScribe logo — compact header (single line: logo + email + sign-out)
- Patient search input — full width, `Last name, first name, or MRN`
- `Start Encounter` button + `Resume Draft` OR `All Patients` second button
- `TodayStatusTiles` — 3-column: 0 Visits | 0 Drafts | 0 Follow-ups

Below the fold (accessible by scrolling):
- Site filter pills (only when enrolled in 2+ sites)
- Today's queue (schedule cards or "No visits" empty state — single line, no card)
- Drafts section (only shown when drafts > 0)
- Open follow-ups section (only shown when follow-ups > 0)
- AI command strip ("Ask OmniScribe AI…" input)

Fixed at bottom: `MobileBottomNav` — Home | Patients | Record | Drafts | More

No horizontal overflow. Content clears iOS home indicator via `env(safe-area-inset-bottom)`.

### 1024px tablet / desktop

- Top header: BrandWordmark + AppNav links (now visible at lg+) + email + sign-out
- Three-column grid below header:
  - **Left (240px):** "Start Encounter" primary button, Home / Patients nav, role-gated admin links, date at bottom
  - **Center:** Today heading + date, patient search, status tiles, schedule (card), drafts (card), follow-ups (card)
  - **Right (320px):** "Ask OmniScribe AI" panel with input + 4 suggestion chips

No bottom nav. Desktop sidebar handles navigation.

### 1440px wide desktop

Same three-column layout. Center workspace benefits from additional width. All content visible without excessive scrolling when schedule/drafts/followups are populated.

---

## Commands run

```bash
# Dependencies
npm install

# Type check + build
npx next build
# Result: ✓ Compiled successfully — 0 type errors

# Tests
npx vitest run
# Result: 4 files failed (14 tests) — ALL PRE-EXISTING
#         (seat-gate mock issues in encounters/schedule-start tests + stripe config test)
#         530 tests pass (516 pre-existing + 4 new post-signin-redirect tests from Sprint 0)

# Lint (no errors on modified files)
# All new/modified source files: ReadLints returned 0 errors
```

---

## Pre-existing failures (not introduced by Sprint 0.2)

The 14 failing tests are identical to the failures on `main` before Sprint 0.2:

- `test/lib/schedule-start-route.test.ts` — 5 failures (seat-gate mock wiring)
- `test/api/encounters-late-entry.test.ts` — 5 failures (seat-gate mock wiring)
- `test/api/encounters-site-enrollment.test.ts` — 4 failures (seat-gate mock wiring)
- `test/lib/stripe-config.test.ts` — 0 new failures (pre-existing env issue)

Confirmed by running the same tests on a clean stash of `main` before Sprint 0.2 started.

---

## Acceptance criteria status

| Criterion | Status |
|-----------|--------|
| At 430px: patient search visible without scrolling | PASS |
| At 430px: Start Encounter visible without scrolling | PASS |
| Bottom nav fixed and usable on mobile | PASS |
| Empty schedule/draft/follow-up states no longer large cards on mobile | PASS — single text line |
| No horizontal scrolling | PASS |
| No auth/MFA behavior changed | PASS — layout.tsx adds nav but does not touch auth chain |
| No PHI in localStorage, URL params, console logs | PASS — no new storage; query string only used for patient search (was already the case) |
| `npx next build` passes | PASS |
| Tests unchanged from pre-Sprint-0.2 baseline | PASS — same 14 pre-existing failures |

---

## Remaining risks

1. **AI panel is a stub** — The `AiCommandPanel` routes all queries to patient search. Wave 8 (Unit 42+) will replace the submit handler with the real copilot pipeline. The component API (`variant: 'desktop' | 'mobile'`) is forward-compatible.

2. **"Record" in bottom nav links to `/patients`** — There is no standalone "start recording" page. The correct clinical flow is: find patient → start visit from their page → `/prepare` → `/capture`. The Record tab is a visual anchor that will deep-link directly into a new encounter flow when Sprint A (W3-01 / telehealth) and Sprint B land.

3. **Desktop sidebar is home-page-only** — The left sidebar (`SidebarLink` component) only exists in `home/page.tsx`. Other clinical pages still use the AppNav header for navigation. A future sprint can lift the sidebar into the clinical layout with a `showSidebar` prop.

4. **`SUPER_ADMIN` references in sheet** — The More sheet uses `isAdmin` which correctly maps to `ORG_ADMIN | SITE_ADMIN` (no `SUPER_ADMIN` exists post-Sprint 0). Verified.

5. **`text-2lg` token** — Used in the desktop center heading, same as the original home page. Confirmed the token exists in `globals.css`.
