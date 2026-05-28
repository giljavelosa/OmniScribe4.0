# OmniScribe — UI Context

> The visual law. Every visible decision lives in this file. Build to it. Extend it when you need a new pattern; never invent one inline.

## Theme

Light-primary with dark-mode fallback. The aesthetic is **calm and clinical**: warm off-white backgrounds, restrained color, muted teal accent. Clinicians work in high-cognition states for long stretches; the UI must not compete for attention. Status colors are the only place color is loud, and even there they're OKLCH-perceptually-uniform.

The visual language is **tablet-first**: clinicians work at bedside or kiosk on a tablet, then transition to desktop for review. Mobile = single-column with bottom nav; desktop = two-pane workspaces.

### Explicit design permissions (apply everywhere in the app)

These patterns are explicitly allowed and encouraged across all surfaces:

1. **Full-width solid-color bars.** Headers, bottom navigation bars, section banners, and hero strips may use `bg-primary`, `bg-card`, or any semantic token as a full-bleed background. The top header and the mobile bottom nav use `bg-primary` (deep teal) with `text-primary-foreground` (white) on all clinical surfaces. Admin/owner/ops layouts may adopt the same treatment or use their own accent. A solid-color bar is always preferred over a border-only divider for primary chrome.

2. **Avatars, initials, and user/patient images.** Every entity that has a human identity — clinician, patient, user account — may display a visual avatar. Avatars are rendered as:
   - **Initials circle** — `rounded-full bg-primary/10 text-primary font-semibold` (or role-specific color) with 1–2 character initials derived from first + last name. Default when no photo is set.
   - **Photo avatar** — `<img>` or Next.js `<Image>` with `rounded-full`, `object-cover`, and explicit `width`/`height`. Photos are served via presigned S3 URL (never stored in localStorage or exposed in client logs). Alt text is always the person's display name.
   - **System icon avatar** — Lucide icon in a circle, used for AI / system entities (e.g. the OmniScribe AI panel).
   - Recommended sizes: `h-8 w-8` (compact list rows), `h-10 w-10` (card headers), `h-12 w-12` (profile / detail pages).
   - Use the shared `<UserAvatar>` component (`src/components/ui/user-avatar.tsx`) once built; until then, inline the initials pattern directly.
   - **PHI rule:** patient photos are PHI. Never embed base64 patient photos in HTML. Always use presigned URLs with short TTL. Never log photo URLs.

Source of truth: `src/app/globals.css` — every token defined as a CSS custom property.

## Colors (OKLCH)

All colors are CSS custom properties in OKLCH (perceptual color space). **Components must use tokens — no hardcoded hex or RGB values in clinical or admin surfaces** (ESLint + code review).

### Core palette (light mode)

| Token | OKLCH | Role |
|---|---|---|
| `--background` | `oklch(0.985 0.002 90)` | Page base (warm off-white) |
| `--foreground` | `oklch(0.145 0.015 260)` | Body text (dark slate) |
| `--card` | `oklch(1 0 0)` | Card surface (pure white) |
| `--card-foreground` | `oklch(0.145 0.015 260)` | Text on card |
| `--primary` | `oklch(0.44 0.08 167)` | Deep teal — buttons, focus rings, primary CTAs |
| `--primary-foreground` | `oklch(0.99 0 0)` | Text on primary |
| `--accent` | `oklch(0.96 0.015 167)` | Faint teal tint — subtle highlights |
| `--muted` | `oklch(0.965 0.005 260)` | Very light slate |
| `--muted-foreground` | `oklch(0.35 0.01 260)` | Medium gray — secondary text |
| `--border` | `oklch(0.925 0.005 260)` | Light gray dividers |
| `--destructive` | `oklch(0.577 0.245 27.325)` | Red — dangerous actions only |
| `--ring` | `oklch(0.44 0.08 167)` | Focus ring (matches primary) |

### Status tokens (semantic, light mode; dark overrides in `.dark`)

| Variant | Text | Background | Border |
|---|---|---|---|
| success | `oklch(0.55 0.15 145)` | `oklch(0.96 0.04 145)` | `oklch(0.85 0.08 145)` |
| warning | `oklch(0.55 0.18 75)` | `oklch(0.96 0.05 75)` | `oklch(0.85 0.10 75)` |
| danger | `oklch(0.55 0.22 25)` | `oklch(0.96 0.05 25)` | `oklch(0.85 0.10 25)` |
| info | `oklch(0.55 0.15 240)` | `oklch(0.96 0.04 240)` | `oklch(0.85 0.08 240)` |
| violet | `oklch(0.50 0.18 295)` | `oklch(0.96 0.04 295)` | `oklch(0.85 0.08 295)` |

Status tokens are consumed via two components only — `<StatusBadge>` and `<StatusBanner>`. Never apply status classes directly. Status states ALWAYS reinforced with an icon or text — color is never the only signal.

### Specialized tokens

| Token | Value | Use |
|---|---|---|
| `--highlight-bg` | `oklch(0.92 0.15 95)` | Inactive search/transcript matches (yellow) |
| `--highlight-active-bg` | `oklch(0.78 0.18 65)` | Active match (orange) |
| `--speaker-1` | `oklch(0.45 0.10 200)` | Clinician voice in diarized transcript (blue) |
| `--speaker-2` | `oklch(0.45 0.10 260)` | Patient voice in diarized transcript (purple) |
| `--touch-min` | `2.75rem` (44px) | Minimum touch target — Apple HIG minimum |

### Dark mode

All tokens have `.dark` overrides. Backgrounds darken to `oklch(0.145 0 0)`; status text lifts (higher L) for legibility. Test dark mode on every component; it's not optional.

## Typography

Three font families loaded via `next/font` in `src/app/layout.tsx`:

| Variable | Font | Use |
|---|---|---|
| `--font-inter` | Inter | Body text, default sans-serif |
| `--font-geist-sans` | Geist Sans | Brand wordmark only |
| `--font-geist-mono` | Geist Mono | Code blocks, technical fields (rare) |

Base font-size: **17px** (declared on `html`).

### Type scale — 9 sizes (no `text-[Npx]` in `(clinical)` or `(admin)`)

| Token | Size | Use |
|---|---|---|
| `--text-2xs` | 11px | Dense metadata, table headers, micro-captions |
| `--text-xs` | 12px | Labels, metadata, captions |
| `--text-sm` | 13px | Body small, secondary text |
| `--text-sm-loose` | 14px | Body-secondary, form descriptions |
| `--text-base` | 15px | Body default (most prose) |
| `--text-md` | 17px | Section headers, emphasized |
| `--text-lg` | 21px | h2 headings, key numbers |
| `--text-2lg` | 24px | h1 page titles |
| `--text-xl` | 28px | Hero headlines (marketing only) |

ESLint rule bans `text-[Npx]` in `src/app/(clinical)/` and `src/app/(admin)/`. Marketing pages are scope-allowed.

## Border Radius

10 px base × multipliers. Buttons use `rounded-lg` (10 px). Cards use `rounded-xl` (14 px).

| Token | Computed | Use |
|---|---|---|
| `--radius` | `0.625rem` (10px) | Base |
| `--radius-sm` | 6px | Small buttons, compact inputs |
| `--radius-md` | 8px | Default buttons, form controls |
| `--radius-lg` | 10px | Cards, popovers, standard containers |
| `--radius-xl` | 14px | Large panels, sheets |
| `--radius-2xl` | 18px | Extra-large containers |
| `--radius-3xl` | 22px | Oversized UI (modal backdrop) |
| `--radius-4xl` | 26px | Full-screen modals, edge-to-edge |

## Component Library

**shadcn/ui v4 over Base UI primitives**. Installed in `src/components/ui/`. Do not reinvent — extend with CVA (`class-variance-authority`) variants.

### shadcn/ui primitives to install on day one

`button`, `card` (+ Header / Title / Description / Action / Content / Footer), `dialog`, `alert-dialog`, `sheet`, `tabs`, `dropdown-menu`, `popover`, `label`, `input`, `textarea`, `select`, `switch`, `avatar`, `badge`, `separator`, `tooltip`. Add more as needed via `npx shadcn@latest add <name>`. Never hand-write a primitive.

### Custom shared components to build

| Component | Location | Use |
|---|---|---|
| `BrandWordmark` | `src/components/brand-wordmark.tsx` | OmniScribe logo + wordmark (Geist Sans, teal→green gradient) |
| `StatusBadge` | `src/components/ui/status-badge.tsx` | CVA badge with semantic variants — replaces all ad-hoc status pills |
| `StatusBanner` | `src/components/ui/status-banner.tsx` | Alert banner with icon + title + body + dismiss; `role="alert"` for danger/warning, `role="status"` for info |
| `ProcessingIndicator` | `src/components/ui/processing-indicator.tsx` | 3-gear animated spinner; respects `prefers-reduced-motion` |
| `SectionLabel` | `src/components/ui/section-label.tsx` | 12 px uppercase tracked label primitive |
| `RecordingStatus` | `src/components/capture/RecordingStatus.tsx` | Single source of truth for recording state chip |
| `AudioLevelBars` | `src/components/capture/AudioLevelBars.tsx` | 3-bar VU meter for mic input |
| `SectionProgressStrip`, `SectionProgressCell`, `SectionRegenerateConfirmDialog` | `src/components/notes/` | Per-section status strip + regenerate UI |
| `BriefCard`, `BriefHeader`, `TrajectoryTable`, `FollowUpPreviewList`, `GoalsSnapshot`, `WatchList`, `BriefFooter` | `src/components/brief/` | Brief composition |
| `OpenFollowUpsCard`, `PlanForTodayCard` | `src/components/copilot/cards/` | Watch v0 cards |
| `CopilotBeacon`, `CopilotSheet` | `src/components/copilot/` | Always-available chat trigger + sheet |
| `PatientIdentityHeader`, `InlineEditableField`, `PatientEditSheet`, `SnapshotCard` | `src/components/patients/` | Patient detail surface |

## Layout Patterns

### Root layout (`src/app/layout.tsx`)
Minimal. Loads fonts. `body` is `min-h-full flex flex-col`. Theme is light by default; respects `prefers-color-scheme: dark`.

### Clinical layout (`src/app/(clinical)/layout.tsx`)
Two-tier chrome on mobile/tablet:
- **Top bar** (h-13, 52px) — `bg-primary` full-width teal. `BrandWordmark inverted` (white quill + white text). `AppNav` with `text-primary-foreground` links (hidden on mobile — bottom nav handles navigation at `< lg`). Email + sign-out always visible.
- **Bottom navigation** (fixed, mobile, `lg:hidden`) — `bg-primary` full-width teal. 5 items: Home / Patients / Record / Drafts / More. Lucide icons, white. Active = `bg-white/20` rounded pill. `env(safe-area-inset-bottom)` for iOS notch. `More` opens a Sheet with role-gated admin/owner/ops links.
- **Content** — `flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0` (bottom nav clearance on mobile)

On desktop (`lg+`), clinical chrome is suppressed on focused pages (capture, review, sign) — full-viewport workspaces.

### Capture pages — two layouts

`src/app/(clinical)/capture/[noteId]/_components/`:

- **DesktopCaptureLayout** (`lg:flex`):
  - **Left pane** (`flex-1`) — transcript workspace + live diarized text + mic level bars (top of pane)
  - **Right pane** (`46vw, max 680px`) — prior context panel + live note panel (with section progress strip)
  - **Controls bar** (fixed, bottom-left) — Pause/Resume, Start Drafting, Finish & Review
- **MobileCaptureLayout** (`lg:hidden`):
  - **Tabs** — Transcript / Live Note / History / Setup
  - **Active-tab pulsing dot** when content updates on an unviewed tab
  - **Controls** — full-width below tabs

### Sheets & dialogs

- **Sheet** — side drawer, right by default, `sm:max-w-sm` on desktop, 75% width on mobile.
- **Dialog** — centered modal, `max-w-[calc(100%-2rem)]` mobile, `sm:max-w-sm` desktop.
- **AlertDialog** — for destructive / sensitive actions (sign confirmation, regenerate-edited-section, leave-without-save). **Never native `confirm()`** (rule 22).
- **Overlay** — `bg-black/10` with optional `backdrop-blur-xs`.

#### Internal-scroll sheets (required pattern)

Every Sheet **must** use internal scroll so the base page never moves. Structure:

```tsx
<SheetContent side="right" className="sm:max-w-md flex flex-col gap-0 p-0">
  {/* Fixed header — never scrolls */}
  <SheetHeader className="border-b px-6 py-4">...</SheetHeader>

  {/* Scrollable body — the only thing that moves */}
  <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
    {/* content */}
  </div>

  {/* Fixed footer — never scrolls */}
  <SheetFooter className="border-t px-6 py-4">...</SheetFooter>
</SheetContent>
```

The `flex flex-col gap-0 p-0` on `SheetContent` enables this layout. If the body content fits without scrolling, that is fine — `overflow-y-auto` is a no-op until overflow occurs.

#### Nested (stacked) sheets

Sheets may open further sheets on top. Use a consistent LIFO dismiss pattern: each sheet's X / Cancel closes only itself, returning to the layer below. Never close multiple sheets at once unless explicitly confirming a cancel-all.

### Progressive disclosure — the core page pattern

Every non-trivial page in the clinical and admin surfaces MUST use one of these two techniques to avoid long single-column scroll:

1. **Tabs** — for detail pages with 3+ distinct content areas. The active tab shows a short, focused surface. Other content is hidden, not pushed below the fold.
   - Use `<Tabs>` from `@/components/ui/tabs`.
   - Default to the most clinician-facing tab (e.g. "Overview" or the primary action area).
   - Show count badges on tabs that have data (e.g. `Visits (7)`, `Episodes (2)`).

2. **Collapsible sections** — for lists or repetitive content where the first few rows are the 90% case. Show N rows by default, offer "Show all" toggle.
   - Use for visit history (default: 3 most recent), episode goals, audit entries.

Combined with a **sticky page anchor**, these techniques mean:

- The clinician always has identity + primary action visible.
- Long content is never the default state — it requires an intentional expand.
- Navigating between sections does not lose the current scroll position of other sections.

### Sticky page anchors (required on all detail pages)

Any page that has scrollable content AND a primary action must implement a sticky anchor. The anchor MUST NOT scroll away.

```tsx
{/* Sticky anchor — lives at the top of the page component, before tabs/content */}
<div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b shadow-sm">
  <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3 flex-wrap">
    {/* entity identity — name, key demographic, status badge */}
    {/* primary action button */}
  </div>
</div>
```

Rules:
- `z-30` — above floating content, below modals and sheets (`z-50`).
- `bg-background/95 backdrop-blur-sm` — slightly frosted, not opaque, so the clinician sees they are mid-scroll.
- `shadow-sm` — visually separates from scrolled content without a hard border.
- The anchor contains the minimum info needed to identify the context (patient name + age + MRN) plus the primary action (Start Visit, Save, etc.).
- The full detail header lives in the first tab/section. The anchor is a compact repeat, not a replacement.

### Page composition

- `/prepare/[noteId]` — prior-context brief + Watch cards + setup form
- `/capture/[noteId]` — Desktop or Mobile layout (above); section progress strip across both
- `/processing/[noteId]` — transient reassurance screen (gear animation + escalating empathy)
- `/review/[noteId]` — section-by-section editor; collapsible accordions; readiness panel right side
- `/sign/[noteId]` — attestation surface; final read-only preview; signing-PIN re-verify
- `/patients/[id]` — **sticky anchor** (name + Start Visit) + **four tabs**: Overview / Episodes / Visits / Profile
- `/visits/[noteId]` — **sticky header** + **four tabs**: Note / Handout / Transcript / Recording

Any future detail page (new patient sub-page, admin org detail, etc.) MUST follow the sticky anchor + tabs pattern above. Do not create new long single-column stacks.

## Icons

[Lucide React](https://lucide.dev) is the **only** icon library. Stroke-based; default `strokeWidth: 2`.

| Context | Size |
|---|---|
| Buttons (default) | `size-4` (16px) |
| Buttons (sm) | `size-3` (12px) |
| Bottom nav | `h-[18px] w-[18px]` |
| Header / banner | `h-5 w-5` (20px) |
| Recording controls (Pause/Play) | `h-12 w-12` (48px) |

Decorative icons get `aria-hidden="true"`. Functional icons get `aria-label`.

## Loading & Progress

### ProcessingIndicator
3 interlocking gears spinning at different speeds (11s / 7.5s / 8.5s) — premium, subtle, calm.
- Sizes: `sm` (44px), `md` (62px), `lg` (84px)
- a11y: `aria-label="Processing"`; respects `prefers-reduced-motion` (static at opacity 0.7)
- Color: `text-muted-foreground/40` (very subtle)

### Section progress strip

Per [`references/section-progress-ui-spec.md`](../references/section-progress-ui-spec.md). Horizontal row of `SectionProgressCell`s. Status glyphs:

| Status | Glyph | Meaning |
|---|---|---|
| `empty` | `○` | No content yet |
| `generating` | `⟳` spinner | LLM is writing |
| `populated` | `●` | Content complete |
| `edited` | `✏` | Clinician edited post-population |
| `failed` | `⚠` | LLM failed |

Updates driven by SSE `section.generating` / `section.completed` from `/api/notes/[id]/stream?include=sections`.

### Skeletons
No dedicated skeleton component. Use `opacity-pulse` or `ProcessingIndicator` for loading states. Most clinical surfaces have a relevant in-progress affordance instead of empty skeletons.

## Brand

**Brand name**: **OmniScribe**. Always one word, capital O + capital S. Never variants. This is the canonical name from day one.

### Wordmark
- **Quill icon** — 22×22 SVG, gradient `#064d2a → #0B7A42 → #3da878` (green → teal). On colored backgrounds use `<BrandWordmark inverted />` — quill and text render white.
- **Text "OmniScribe"** — Geist Sans, bold, `text-lg`, gradient fill green → teal → darker teal (default). White when `inverted`.
- **Drop shadow** — `drop-shadow-[0_2px_6px_rgba(0,0,0,0.18)]`
- **Usage:** `<BrandWordmark />` on white/card backgrounds. `<BrandWordmark inverted />` on `bg-primary` or any colored bar.

### PWA manifest
- `theme_color: "#3d8b8b"` — teal, app chrome on mobile
- `background_color: "#ffffff"` — splash screen

### Primary brand color
`--primary: oklch(0.44 0.08 167)` ≈ #0F6E56 (deep teal). Used for buttons, focus rings, nav active state.

## Accessibility

- **Focus rings** — `focus-visible:ring-3 focus-visible:ring-ring/50` (uses `--ring`, teal)
- **ARIA roles** — `role="alert"` on StatusBanner danger/warning, `role="status"` on info/neutral
- **Icon semantics** — `aria-hidden="true"` decorative, `aria-label` functional
- **Invalid state** — `aria-invalid` selector styles for fields/buttons in error
- **Touch target** — minimum 44 px (`--touch-min: 2.75rem`)
- **Color contrast** — OKLCH for perceptual uniformity; status colors high-contrast on their backgrounds; **status states ALWAYS reinforced with icon or text** — color is never the only signal
- **Reduced motion** — animations respect `prefers-reduced-motion` (ProcessingIndicator goes static)
- **Keyboard nav** — every interactive surface tab-reachable; Tab order matches visual order; AlertDialog traps focus

## Responsive

Tailwind v4 defaults:

| Breakpoint | Min width | Primary use |
|---|---|---|
| `sm` | 640px | Compact phones (rare for clinicians) |
| `md` | 768px | Larger phones, small tablets |
| `lg` | 1024px | **Primary clinical breakpoint** — switches capture from mobile-tabbed to desktop two-pane |
| `xl` | 1280px | Standard desktop |
| `2xl` | 1536px | Large monitors (note review at depth) |

Strategy: **mobile-first, tablet-optimized**. Single-column on mobile; mid-width sheets/modals at `md`; two-pane workspaces at `lg+`. Bottom nav on `< lg`; suppressed on capture/review/sign at `lg+`.

## Decision Heuristics (when in doubt)

1. **Use a token, not a value.** If you're typing a hex code or a `text-[Npx]` in a clinical/admin surface, stop. Open `globals.css` — the token exists. If it doesn't, propose it as a token first, then use it.
2. **Use primitives, not bespoke.** If you're styling a button, dialog, or popover from scratch, you're doing it wrong. Extend the primitive with CVA variants.
3. **Status needs icon AND color.** Color-vision-deficient clinicians still need to read status. If you can only tell `danger` from `success` by hue, fix it.
4. **AlertDialog, never `confirm()`.** Even for "leave without saving?"
5. **Touch targets ≥ 44 px.** Clinicians use tablets.
6. **OmniScribe — one word.** No variants. No abbreviations.
7. **Full-width colored bars are the standard chrome.** Top header and mobile bottom nav use `bg-primary` (teal) throughout the app. Do not revert to `bg-card border-b` for primary navigation chrome. See "Explicit design permissions" above.
8. **Avatars everywhere a human is named.** Any list row, card, or header that shows a clinician or patient name should pair it with an initials circle or photo avatar. Use the initials pattern until `<UserAvatar>` exists. Never show a name without a visual anchor.
9. **Detail pages use sticky anchor + tabs.** If a page has 3+ distinct content areas or requires scrolling to reach the primary action, it MUST have a sticky mini-header and tabs. A long vertical stack is never the answer. See "Progressive disclosure" and "Sticky page anchors" above.
10. **Sheets scroll inside themselves.** The base page never moves when a sheet is open. Use `flex flex-col` + `flex-1 overflow-y-auto` body to contain scroll inside the sheet. See "Internal-scroll sheets" above.

## What to read next (visual design deep dives)

- Full design across all screens: [`references/design-redesign-spec.md`](../references/design-redesign-spec.md)
- Capture-flow pitfalls to avoid: [`references/design-critique-capture-flow.md`](../references/design-critique-capture-flow.md)
- What was broken in earlier prototypes (avoid in v1): [`references/design-critique.md`](../references/design-critique.md)
- Section progress UI components: [`references/section-progress-ui-spec.md`](../references/section-progress-ui-spec.md)
- Prior-context brief UI: [`references/prior-context-brief-ui-spec.md`](../references/prior-context-brief-ui-spec.md)
- Patient detail UI: [`references/patient-detail-ui-spec.md`](../references/patient-detail-ui-spec.md)
- Per-screen gap analysis: [`references/design-mockup-gap-analysis/`](../references/design-mockup-gap-analysis/)
- Visual mockups: [`references/design-mockups.html`](../references/design-mockups.html)
