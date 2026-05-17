# OmniScribe — UI Context

> The visual law. Every visible decision lives in this file. Build to it. Extend it when you need a new pattern; never invent one inline.

## Theme

Light-primary with dark-mode fallback. The aesthetic is **calm and clinical**: warm off-white backgrounds, restrained color, muted teal accent. Clinicians work in high-cognition states for long stretches; the UI must not compete for attention. Status colors are the only place color is loud, and even there they're OKLCH-perceptually-uniform.

The visual language is **tablet-first**: clinicians work at bedside or kiosk on a tablet, then transition to desktop for review. Mobile = single-column with bottom nav; desktop = two-pane workspaces.

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
- **Top bar** (h-13, 52px) — `BrandWordmark` only; light border-bottom
- **Bottom navigation** (fixed, mobile) — 5 items: Home / Patients / Drafts / Templates / Profile. Lucide icons. Active = teal background + shadow lift + `-translate-y-1`. `max-w-lg` constraint.
- **Content** — `flex-1 overflow-y-auto pb-20` (padding for bottom nav)

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

### Page composition

- `/prepare/[noteId]` — prior-context brief + Watch cards + setup form
- `/capture/[noteId]` — Desktop or Mobile layout (above); section progress strip across both
- `/processing/[noteId]` — transient reassurance screen (gear animation + escalating empathy)
- `/review/[noteId]` — section-by-section editor; collapsible accordions; readiness panel right side
- `/sign/[noteId]` — attestation surface; final read-only preview; MFA re-verify
- `/patients/[id]` — identity header + snapshot strip + visit history + reference cards

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
- **Quill icon** — 22×22 SVG, gradient `#064d2a → #0B7A42 → #3da878` (green → teal)
- **Text "OmniScribe"** — Geist Sans, bold, `text-lg`, gradient fill green → teal → darker teal
- **Drop shadow** — `drop-shadow-[0_4px_10px_rgba(0,0,0,0.22)]`

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

## What to read next (visual design deep dives)

- Full design across all screens: [`references/design-redesign-spec.md`](../references/design-redesign-spec.md)
- Capture-flow pitfalls to avoid: [`references/design-critique-capture-flow.md`](../references/design-critique-capture-flow.md)
- What was broken in earlier prototypes (avoid in v1): [`references/design-critique.md`](../references/design-critique.md)
- Section progress UI components: [`references/section-progress-ui-spec.md`](../references/section-progress-ui-spec.md)
- Prior-context brief UI: [`references/prior-context-brief-ui-spec.md`](../references/prior-context-brief-ui-spec.md)
- Patient detail UI: [`references/patient-detail-ui-spec.md`](../references/patient-detail-ui-spec.md)
- Per-screen gap analysis: [`references/design-mockup-gap-analysis/`](../references/design-mockup-gap-analysis/)
- Visual mockups: [`references/design-mockups.html`](../references/design-mockups.html)
