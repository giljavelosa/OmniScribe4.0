# Unit 36: Mobile / PWA Polish

## Goal

Wave 6 continuation. The app already ships some mobile-first
infrastructure: `--touch-min: 2.75rem` (44px = Apple HIG minimum)
exists as a CSS token; a global `prefers-reduced-motion: reduce`
block honors users who request motion suppression; a
`MobileCaptureLayout` already differentiates the capture surface
on small viewports. What's still missing:

- **No PWA manifest** — clinicians can't install the app to their
  iPad home screen; offline behavior is browser-default (white
  screen of death on connectivity drop).
- **No offline fallback page** — when the network's gone, fetch
  failures surface as ungraceful errors instead of an installable
  "Reconnect when ready" surface.
- **No `usePrefersReducedMotion` hook** — the global CSS suppresses
  animations, but client components that programmatically tween or
  use motion libraries have no way to read the user's preference.
- **No touch-target audit** — `--touch-min` exists but is not
  enforced. There's no script that catches "this button is below
  44px tall" before code review.

Unit 36 closes those four gaps:

1. **PWA manifest + icons** — `public/manifest.json` + iPad-friendly
   icon set. `<link rel="manifest">` in the root layout.
2. **Service worker + offline fallback** — minimal SW that caches the
   static shell + serves `/offline` when fetch fails. Registered via
   a tiny client component that doesn't block first paint.
3. **InstallPrompt component** — listens for `beforeinstallprompt`,
   surfaces a "Install OmniScribe" CTA, fires `PWA_INSTALL_PROMPTED`
   audit when user accepts. Hidden on already-installed sessions
   (`display-mode: standalone`).
4. **`usePrefersReducedMotion` hook** — reads + subscribes to the
   media query. Components opt in (`if (reducedMotion) return null`).
5. **Touch-target audit script** — `scripts/touch-target-audit.mjs`
   walks the `.tsx` files in clinical/admin surfaces, looks for
   `<button>`/`<a>`/`<Button>` elements without `min-h-[var(--touch-min)]`
   or `h-touch-min` or a parent that enforces it. Reports findings;
   no auto-fix in v1.

> **Unit 36 ships when** an iPad user can: visit /home → see a
> browser-rendered "Add to Home Screen" experience (manifest +
> theme-color + icons present); the InstallPrompt UI appears on
> first visit when `beforeinstallprompt` fires; tap Install →
> `PWA_INSTALL_PROMPTED` audit row written; close + relaunch from
> home screen → app boots in standalone mode + service worker is
> active; turn off Wi-Fi + navigate → `/offline` page renders;
> `npm run touch-audit` returns a clean report (or, if findings exist,
> a list of files+line ranges flagged for a polish PR).

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | PWA library | Hand-rolled. `next-pwa` adds Workbox-as-bundle overhead + a build-time SW generation step that fights Next 16's standalone output. v1 ships a hand-written 50-line SW because our caching needs are simple: cache the static shell, network-first for `/api/*`, serve `/offline` on fetch failure. Promotes to next-pwa / Workbox when we want sophisticated cache strategies. |
| 2 | Manifest scope | Root `/`; `display: standalone`; `theme_color` matches the existing `viewport.themeColor` from `layout.tsx` (#3d8b8b). `icons` array points to a 192x192 + 512x512 PNG generated from the brand quill SVG. |
| 3 | Service worker scope | Top-level `/sw.js`. Registers from a client component mounted in root layout (lazy via `useEffect`). Cache-first for `/_next/static/*` + `/icons/*` + offline fallback HTML; network-first for everything else. Never caches `/api/*` responses (PHI risk + would defeat the audit trail). |
| 4 | Offline fallback page | `/offline` — server-rendered static HTML (no auth gate; safe to cache). Renders the brand wordmark + "You're offline. Reconnect when ready." copy. Provides a "Try again" button that does `window.location.reload()`. |
| 5 | Install prompt audit | New `PWA_INSTALL_PROMPTED` audit action. Fires when the user accepts via the `beforeinstallprompt` event flow. Metadata: `{ outcome: 'accepted' \| 'dismissed', platforms?: string[] }`. PHI-free. |
| 6 | Install prompt visibility | Hidden when `window.matchMedia('(display-mode: standalone)').matches` (already installed) OR when user previously dismissed (one-shot per `localStorage` key `omniscribe.installPromptDismissedAt`). Reappears 30 days after dismissal. |
| 7 | `usePrefersReducedMotion` API | Hook returns `boolean`. Subscribes via `matchMedia.addEventListener('change')`. SSR-safe: returns `false` on the server (default to "motion allowed" since SSR can't know; client hydration corrects). |
| 8 | Touch-target audit scope | Walks `src/app/(clinical)/**/*.tsx` + `src/app/(admin)/**/*.tsx` + `src/components/**/*.tsx`. Greps for elements with class strings that don't contain `min-h-[var(--touch-min)]`, `h-touch-min`, `size-touch-min`, `min-h-touch`, OR a known Button component (Button primitive already enforces touch-min internally). Reports file + line. CLI exit code 0 (informational); meant for a `npm run touch-audit` script, not a CI gate. |
| 9 | iPad-specific layout audit | Manual inspection only in v1 — the spec doesn't enumerate fixes. If the touch-target audit finds known issues, fixes land in a follow-up polish PR (each is small + independent). |
| 10 | Stub-mode | All Unit 36 features work without external services. PWA install prompt is a no-op in browsers that don't support `beforeinstallprompt` (Safari). |

## Design

### Manifest

```json
{
  "name": "OmniScribe",
  "short_name": "OmniScribe",
  "description": "HIPAA-grade medical AI scribe with an integrated agentic clinical copilot, self-serve registration, and strict audited platform-owner workflows for validated registration and tenant-database deletion requests.",
  "start_url": "/home",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#3d8b8b",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

Root layout adds `<link rel="manifest" href="/manifest.json">` via the
existing Next metadata API.

### Service worker

`public/sw.js` — three caches:
- `static-v1` — `/_next/static/*`, `/icons/*`, `/manifest.json`,
  `/offline`. Cache-first.
- `pages-v1` — top-level page navigations (cache-first with a freshness
  check; serve from cache on network failure).
- (No `api-v1` cache — `/api/*` always network-first and never
  written to cache because (a) PHI risk and (b) bypassing the audit
  trail by replaying a cached response would be invisible to the
  auditor lens.)

Lifecycle:
- `install` event: pre-cache the static shell + offline page.
- `fetch` event: route to the appropriate cache; fall back to
  `/offline` on hard fetch failure for page navigations; rethrow
  fetch errors for API calls (caller handles).
- `activate` event: clean up old cache versions.

### Install prompt

```tsx
// src/components/pwa/install-prompt.tsx
'use client';

const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function InstallPrompt() {
  // Listen for beforeinstallprompt → stash event → show CTA
  // On click: prompt() → audit outcome → hide
  // Hidden when display-mode: standalone OR within dismissal TTL
}
```

The `PWA_INSTALL_PROMPTED` audit row writes via a tiny `/api/pwa/install-event` endpoint (POST). PHI-free.

### `usePrefersReducedMotion`

```ts
// src/lib/hooks/use-prefers-reduced-motion.ts
export function usePrefersReducedMotion(): boolean;
```

SSR returns `false` (motion allowed). Client subscribes to the media
query change event + updates state. Memoized so unmounting components
don't leak listeners.

### Touch-target audit script

```
scripts/touch-target-audit.mjs
  Reads .tsx files in scope.
  For each <button|a|Link>:
    - Skip if class includes Button primitive (h-9, h-10, etc. via CVA)
    - Skip if class includes `min-h-[var(--touch-min)]` or `size-touch-min`
    - Otherwise flag with file + line + the class string
  Exits 0 (informational).
```

## Implementation order

1. Spec + manifest.json + reduced-motion globals (already exist; verify + document) + 1 audit action (this commit)
2. Service worker + `/offline` page + InstallPrompt + register-sw client component
3. `usePrefersReducedMotion` hook + touch-target audit script + tests
4. Tracker + PR #37

## Out of scope (Unit 36)

- Background sync API (queue mutations while offline + replay on reconnect)
- Push notifications (browser push for follow-up reminders)
- Periodic background sync (cache refresh while idle)
- Auto-fix for touch-target violations (audit reports only; fixes are per-surface polish PRs)
- iPad-specific layout fixes (audit + polish PRs follow as findings warrant)
- Native iOS app wrapping (Capacitor / Tauri)
- Web Share API integration (clinician shares a note URL)
- Workbox / next-pwa adoption (hand-rolled SW is sufficient for v1)

## Verify when done

- `public/manifest.json` present + linked from root layout via Next metadata API.
- 1 new audit action: `PWA_INSTALL_PROMPTED`.
- Service worker registers on first page load (visible in browser DevTools → Application → Service Workers).
- `/offline` route renders without auth.
- Turning off network + reloading a previously-visited page falls back to `/offline` (page navigations only — API failures still surface to the caller).
- `<InstallPrompt />` renders only when `beforeinstallprompt` fires + user hasn't recently dismissed.
- `usePrefersReducedMotion()` returns `true` when the OS preference is set (verified via DevTools "emulate prefers-reduced-motion").
- `npm run touch-audit` runs cleanly (or reports findings without crashing).
- `npm run build`, `npm run lint`, `npm test` all green.
- progress-tracker.md updated; PR #37 stacked on Unit 35.
