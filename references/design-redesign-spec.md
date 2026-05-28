# OmniScribe Redesign Spec

**Author:** Claude (with Gil)
**Date:** April 29, 2026
**Status:** Recommendation — ready for product/engineering review

## How to use this document

This is the implementation playbook for the redesign work discussed during the design critique. It lives alongside two earlier files in this folder:

- `design-critique.md` — full-app audit (every screen)
- `design-critique-capture-flow.md` — deep dive on the capture flow specifically
- `design-redesign-spec.md` — this file, the *recommended path forward*
- `design-mockups.html` — open this in a browser to see all five mockups together

Read order if you're new: critique → this spec → mockups. If you're an engineer scoping work: jump to "Implementation roadmap" at the end.

## The big idea in two sentences

OmniScribe's user base is 40% mobile, 40% tablet, 20% desktop — so the product must be designed mobile-first, with the side-by-side split layout as a bonus for wider screens. The current capture screen treats desktop as primary and shoves mobile into tabs as an afterthought; this spec flips that.

## The seven design principles

These are the rules the rest of the spec assumes. If a future feature contradicts one of these, it has to defend why.

1. **One source of truth for recording status.** The header owns "are we recording?" Every other surface shows generation status, transcript status, or section progress — never recording status.

2. **Smart defaults beat input fields.** Setup pre-fills from the patient's last note. The clinician's job is to override the rare exception, not configure every encounter from scratch.

3. **Inverted button polarity.** The most affirmative action gets the loudest visual weight. Right now Finish (a recoverable terminal action) is red and Start Drafting (the affirmative primary) is outlined. That's backwards.

4. **Trust through transparency.** Audio level meter beside the recording dot. Section progress visible without scrolling. AI alerts surface known issues with one-tap source links. Clinicians don't have to guess what the system knows.

5. **The screen should be ignorable.** A clinician walking into prepare with a patient already in front of them should be able to glance, confirm, tap Start. Five-second budget. Every element fights for it.

6. **Adaptive panel weighting follows attention.** During listening, transcript dominates. During drafting, the live note dominates. During review, both matter equally — show them side by side on wider screens, tabbed on narrow.

7. **Tap-to-source is the universal action.** Anywhere the AI made a claim — a note section, a flagged discrepancy, a coding suggestion — the user can tap to see the transcript turns it came from. This is what trust looks like at the interaction level.

## Responsive strategy

Three modes, separated by width breakpoints:

- **Mobile** (≤640px) → tabs, single panel at a time
- **Tablet portrait** (641–900px) → tabs (same pattern as mobile, larger touch targets)
- **Tablet landscape + desktop** (>900px) → split layouts (capture: transcript + live note; review: note + transcript)

The crossover is at 900–960px specifically so portrait tablets get tabs (better than a cramped split at 768px) and landscape tablets get the split (enough width for both panels).

## Design system tokens to standardize

These need to exist as design tokens before screen-level work makes sense. Without them, every component will keep drifting.

**Type scale** — collapse from 11 sizes to 6:

| Token | Pixels | Usage |
|---|---|---|
| `--text-xs` | 12 | Labels, metadata, captions |
| `--text-sm` | 13 | Body small, secondary text |
| `--text-base` | 15 | Body default |
| `--text-md` | 17 | Section headers, emphasized text |
| `--text-lg` | 21 | Page titles, key numbers (timer) |
| `--text-xl` | 28 | Hero headlines (rare) |

Ban arbitrary `text-[Npx]` Tailwind classes via ESLint.

**Spacing scale** — collapse from 8+ values to 5:

| Token | Pixels | Usage |
|---|---|---|
| `--space-1` | 4 | Tight inline gaps |
| `--space-2` | 8 | Default inline gap |
| `--space-3` | 12 | Component-internal padding |
| `--space-4` | 16 | Component-external padding |
| `--space-6` | 24 | Section gaps |

**Status colors** — replace hardcoded amber/blue/green Tailwind classes:

| Token | Usage |
|---|---|
| `--status-success` | Reviewed, draft live, signed |
| `--status-warning` | AI flagged for review, needs attention |
| `--status-info` | Reconnecting, processing |
| `--status-danger` | Recording active, errors, destructive |
| `--status-neutral` | Pending, not started |

Each token includes a background, foreground, and border variant. Auto-adapts to dark mode.

**Speaker colors** — define globally so capture and review use the same:

| Token | Hex | Usage |
|---|---|---|
| `--speaker-1` | #0F6E56 | First speaker (later assigned to clinician) |
| `--speaker-2` | #185FA5 | Second speaker (later assigned to patient) |

**Touch target minimum:** 44×44px for any tap target on mobile/tablet. The current `h-7` (28px) buttons fail Apple HIG and are genuinely hard to hit at the bedside.

**Brand naming:** Pick one. The folder says "Genscribe," the actual UI says "OmniScribe." Search and replace whichever loses, in one PR. Add a single `APP_NAME` constant. **This is non-negotiable for ship readiness.**

## Screen specs

### Prepare screen (mobile)

The pre-flight check before recording. Mobile mockup is the primary; tablet portrait inherits.

**Goal:** Five-second decision. Confirm patient, glance at context, tap Start.

**Anatomy (top to bottom):**

1. **Status bar** (system, untouched)
2. **App bar** — back arrow, patient name (15–17px, weight 500), patient meta line (DOB, MRN, visit type) at full primary text contrast — *not* the muted /50 it is today.
3. **Prior context card** — last visit one-liner, paragraph summary, active goals as the most actionable thing. "Full history →" link top-right.
4. **Note setup card** — three pre-filled rows (Type, Style, Template), each with a small green tick. "Adjust →" link top-right opens a sheet for override.
5. **Bottom zone** — single primary CTA "Start recording" (filled teal, 48px tall). Below: "Upload audio · Paste transcript" as quiet text-link alternatives. "Cancel visit" as a tiny tertiary link at the very bottom.

**Edge cases:**
- *First visit for patient* → Prior context card shows soft empty state ("First visit for [first name] — no prior notes yet"). Don't hide the card.
- *Setup defaults unavailable* → Setup card shows single primary action "Configure setup →" instead of pre-filled rows.
- *Backfill mode* → Amber banner above prior context noting date of service. CTA changes to "Add transcript."
- *Sibling episodes* → Small chip in patient block ("2 related notes from this episode").

**Engineering notes:**
- The setup smart-defaults logic lives server-side: when a note is created in PREPARING status, fetch the patient's most recent signed note's setup metadata and pre-populate. If unavailable, leave fields null and the UI shows the "Configure setup" state.
- The "Adjust" sheet is the same component as the existing `DocumentationSetupPanel`, just opened from a different entry point.
- Cancel-visit confirmation must be a Radix `AlertDialog`, not native `confirm()`.

### Capture screen — mobile (primary)

The dominant case. Tabbed layout, panel-at-a-time.

**Goal:** Stay out of the way. Recording happens, drafting happens, the screen mostly proves "this is working."

**Two stages:**

**Stage 1 — Listening (no draft yet)**

Tab order: **Transcript** (default) · Setup *(badge if incomplete)* · More

- App bar: back · patient name · single recording status pill in the top right (red dot, audio meter bars, timer, all in one chip)
- Transcript tab content: speaker-color-coded utterances, generous line height, live segment with a left teal border. *Per the user-research insight that clinicians don't read the transcript during recording, this view can be simplified to a "trust dashboard" — last 3 utterances, big audio meter, turn counter — rather than a full readable feed. Worth user-testing both versions.*
- Bottom bar: pause icon button · **Start drafting** primary CTA (filled teal, large) · overflow `⋯` menu (Cancel visit, Setup if hidden)

**Stage 2 — Drafting (after Start drafting)**

Tab order: **Live note** (default, auto-switched) · Transcript *(badge when new turns since last visit)* · More

- App bar: identical, status pill secondary text reads "recording · drafting"
- Sticky section progress strip at top of Live note tab: `S ✓ · HPI ✓ · Exam · A ○ · P ○`. Tappable to jump.
- Live note content: section by section, each with regenerate icon (`↻`), generating indicator on the active section.
- Bottom bar: pause icon button · **Finish & review →** primary CTA

**Critical mobile-specific behaviors:**

- **Auto-switch tab on Start drafting fires** — instantly route to Live note tab, with a 1-second toast "Drafting started."
- **Update dot** on inactive tab when content changes (new transcript turn while on Live note; new section drafted while on Transcript).
- **Section progress is always visible** — sticky inside Live note tab, doesn't scroll out of view.
- **Auto-scroll Live note only when at bottom** — if the user scrolled up to read, never yank them back.

### Capture screen — desktop / tablet landscape (bonus)

Side-by-side. Two panels visible simultaneously. Adaptive width ratio that animates 250ms when stage changes.

**Stage 1 — Listening:** transcript ~65% / sidebar ~35% (compact setup card on top, prior context card below)

**Stage 2 — Drafting:** transcript ~36% / live note ~48% / prior-context peek rail ~16% on the far left

The peek rail in Stage 2 is the key insight: prior context becomes a thin always-visible rail, not a swap. Today the panel content swaps from PriorContextPanel → LiveNotePanel and the context disappears. Don't do that. Make it ambient.

### Review screen — mobile (primary)

Where the transcript actually earns its keep. The clinician spends most of their post-encounter time here.

**Anatomy:**

1. **App bar** — back, patient name, encounter date · duration · in-person, "Saved" indicator
2. **Section progress strip** (clickable navigation) — `S ✓ · HPI ✓ · Exam · A ✓ · P` (active)
3. **AI alert banner** (when applicable) — surfaces flagged discrepancies, low-confidence sections, contradictions. Each alert has a single action: "View source →" that jumps the Transcript tab to the relevant turn.
4. **Tabs** — **Note** (default) · Transcript · More
5. **Note content** — sections with reviewed status (`✓ Reviewed` or `○ Not reviewed`), regenerate icon, inline edit on tap
6. **Bottom bar** — Save draft (outline) · Sign & finalize (primary, requires biometric/PIN confirmation)

**Critical behaviors:**

- **Inline editing, not a separate screen.** Tap a section → it expands into an editor in place. No route navigation. Teal border indicates edit mode.
- **Per-section reviewed status** — gentle marker, auto-marks reviewed when edited or confirmed. Sign button doesn't block on unreviewed sections, but warns ("You haven't reviewed Exam — sign anyway?").
- **AI flag system is the highest-leverage feature on the entire product.** Invest in it as its own product surface.
- **Tap-to-source on any sentence** — long-press reveals action sheet: View source · Regenerate just this · Copy.

### Review screen — desktop / tablet landscape (bonus)

Side-by-side: note left ~50%, transcript right ~50%. Both visible, bidirectionally linked.

**Key additions over mobile:**

- **Speaker assignment** lives in the transcript panel header. Once "Speaker A → Dr. Patel" is confirmed, propagates to all turns and persists on the saved note.
- **Source highlighting** is bidirectional. Selecting a note section tints its source turns on the right (`var(--color-background-info)` background). Clicking a transcript turn pulses the section it informed.
- **Search** the transcript (⌘F native or visible search box). Long encounters have hundreds of turns; this matters.
- **Sign button reachable from top OR bottom.** Top for the clinician who's done in under a minute; bottom for the one who scrolled through carefully. Both trigger the same biometric/PIN modal.

### Home / patient picker (mobile + desktop)

The launcher. Optimize for fast departure: clinicians don't read this screen, they bounce off it within seconds toward their next task.

**Goal:** From home to recording, two taps for the common case (known patient, live visit).

**Critical changes from current state:**

- **Embedded patient search replaces the hero CTA.** Currently a 🎙 emoji button opens a 3-step `StartDocumentingModal` (When / How / Who). For the 90% case (live visit, known patient), this is overkill. New pattern: search field on home → autocomplete → tap result → prepare screen. The modal still handles edge cases (backfill, paste transcript) but only reachable via overflow.
- **Compact greeting.** One line: "Good morning, Gil · Tuesday, Apr 29." Currently the greeting + date eats ~110px of vertical space before any actionable content. Redesign uses ~50px.
- **Resume card is conditional and visually distinct.** When there's an active or paused recording, a soft-red resume card appears above the search field. When there isn't, the card isn't rendered at all — the greeting flows straight into search.
- **Recent patients with one-tap Start.** Each recent patient row has a labeled primary "Start visit →" button (replacing the current generic mic icon that doesn't say what tapping does).
- **Patient list takes the full width on desktop / tablet landscape.** Earlier draft used a 1.5fr / 1fr left-right split with the patient list on the left and the attention sidebar on the right — but at tablet landscape (~1024px) the patient row got squeezed and content clipped. Solution: patient list spans the full content width; attention + stats become a horizontal footer strip below the list with a tinted background.
- **Patient row uses table-aligned columns.** Header row at the top labels the columns (Patient · Identity · Last visit), every row aligns to those columns. DOB / MRN values use monospace + tabular-nums so digits line up vertically across rows. Avatars are dropped — generic letter circles are decorative noise on a clinical product.
- **3px colored left-accent for status patients.** Replaces the in-line status chip pulling for attention. Patient with unsigned note → soft amber bar. Otherwise transparent. Adds rhythm without forcing color on every row.
- **Patient name as the row's focal point.** 15–17px medium with subtle negative letter-spacing. Demographics ("68 · Female") sit underneath in muted secondary text. Identity (DOB, MRN) and visit context get their own dedicated columns.
- **Single Needs Attention card.** Replaces the three near-identical "X notes ready to sign / X drafts in progress / X notes have unresolved flags" cards that all link to `/drafts`. One card, count badge, bullet breakdown, single CTA.
- **Vanity stats removed.** "Notes this week / avg per day" isn't actionable on home. Replaced by a single deadline-oriented stat ("5 notes due to sign this week, 2 overdue") if anything.
- **No 🎙 emoji on the primary CTA.** Lucide `Mic` icon. Emoji rendering varies by platform and isn't accessible to screen readers without aria-label.

**Engineering notes:**

- The patient search backend already exists (`/api/patients`). Add fuzzy matching by name + MRN.
- ⌘K keyboard shortcut on desktop should focus the search field.
- The Resume card pulls from the same `buildHomeHero()` logic — keep that abstraction.
- Hardcoded hex colors (`border-l-[#EF9F27]`, `border-l-[#378ADD]`, `border-l-[#E24B4A]`) on the Needs Attention cards become unnecessary because the cards are gone.
- Recent patients: extend the API to include DOB and MRN in the response (currently only firstName/lastName/id).

### Patient detail page (medical + rehab variants)

The clinical reference surface. The page a clinician opens when they want to know "what's the deal with this patient?" before walking into a room. Currently a launcher disguised as a chart — almost no clinical context, just demographics and a flat visit list.

**Goal:** Pre-visit prep in 5 seconds. Recent vitals, problem list, allergies, meds, recent assessment snippets — all visible without scrolling.

**Critical changes — both variants:**

- **`max-w-[800px]` removed.** Same wasted-space issue as drafts and home. The patient detail page deserves the full width — it's a clinical reference surface, not a list.
- **Add a snapshot strip** below the identity header. Horizontal row of 5–6 most-recent measures. *Content depends on division* (vitals for medical, functional measures for rehab).
- **Visit history shows assessment / measurement snippets per visit.** Currently just date + status badge. Adding a 2-line snippet from the signed note's `finalJson` makes recent history scannable in seconds. Free upgrade — the data already exists.
- **Replace inline edit form with `<AlertDialog>` or sheet.** Currently the edit form replaces the entire patient header. Too heavy for what's usually a quick MRN tweak. Use an inline-editable pattern (click a field → editable in place) for demographics, and a sheet for full edit.
- **Recert/reopen modal becomes `<AlertDialog>`.** Replace the custom black-overlay pattern.
- **Tokenize all status pill colors** (currently `bg-blue-50 text-blue-700`, `bg-amber-50 text-amber-700`, `bg-red-50 text-red-700`, etc.).
- **Two-column body layout** (desktop): primary clinical content left, reference cards right.
- **Mobile collapses to a single column** with sections stacked. Snapshot strip becomes horizontally scrollable. Sticky bottom "Start visit" button.
- **Single primary CTA in the header** — "Start visit →" replaces the giant card-styled CTA. Edit demotes to overflow `⋯`.

**Conditional rendering by division:**

The same page renders different content for `MEDICAL` vs `REHAB` (and `BEHAVIORAL_HEALTH`) division. Don't build separate routes — share the layout, swap the content.

**Medical variant:**

- *Snapshot strip:* BP, HR, BMI, recent labs (A1C, lipids), immunizations.
- *Right column:* Active conditions / problem list · Allergies · Medications · Active goals · Episodes (rare).
- *Visit history snippets:* Assessment text from the signed note.

**Rehab variant:**

- *Snapshot strip:* Pain (with delta), key ROM, strength, functional score (LEFS / DASH / KOOS), gait speed.
- *Right column:* Plan of Care (primary, prominent card) · Functional goals with progress bars · Outcome measures · Allergies. **No medications card** (PTs don't prescribe).
- *Visit history snippets:* Measurement deltas (Pain · Flex · Strength · LEFS) per visit + Plan text. Visit count chip ("Visit 7 / 12").
- *Plan of Care card* shows: diagnosis + ICD-10, discipline, frequency, duration, authorized visits progress bar (info blue), cert period progress bar (warning amber), recert countdown.
- *Functional goals* show baseline → current → target with a percentage-filled bar. Goal-driven treatment requires goal-driven UI.
- *Outcome measures card:* standardized scores (LEFS, Tegner, NPRS) tracked over time with target values. These are the formal endpoints rehab clinicians report to insurers.
- *Referring physician* visible in identity row ("Referred by Dr. Smith · Ortho").
- *Discipline tag* in demographics line ("Physical Therapy") and on every visit row.

**Data model gaps:**

The redesign assumes fields that don't exist in the current Prisma schema:

- `Patient.activeConditions` — array of `{name, since, code}`
- `Patient.allergies` — array of `{substance, severity, reaction}`
- `Patient.medications` — array of `{name, dose, frequency, status}` *(medical-only)*
- `Patient.snapshotVitals` — denormalized most-recent vitals from latest signed note (or computed on read)
- `Episode.functionalSnapshot` — current measurement values *(rehab-only)*
- `Episode.outcomeMeasures` — array of `{name, baseline, current, target}` *(rehab-only)*
- `EpisodeGoal.progress` — baseline / current / target tuples for quantitative goals

Recommended hybrid approach: AI extraction provides a draft from signed notes, clinician confirms/edits inline on the patient detail page itself. Each card has a small `Edit` link for manual override.

For rehab specifically: the functional snapshot belongs on the *Episode* record, not the Patient — measurements are episode-specific (separate episodes for shoulder vs. knee can have different ROM values). The patient-level snapshot strip pulls from the active episode.

**Engineering notes:**

- Visit history snippets can be derived from the existing `Note.finalJson` — the Assessment section already exists, just surface it.
- Snapshot strip should be cached / pre-computed on the patient record to avoid recomputing on every page load.
- Conditional rendering by division should live in a single `<PatientContextPanel>` component that switches sub-components based on `patient.division`.
- The medical → rehab division switch can happen at the encounter level if a patient has notes from multiple divisions; show the most-recent division's variant by default with a toggle.

### Telehealth (patient + clinician video visits)

Patient-facing surface. Audience flips entirely from the clinician-focused product. Currently both routes (`/waiting/[sessionId]` and `/room/[sessionId]`) are stubs — waiting room shows "Video visits coming soon," room falls back to audio-only capture.

**Goal:** Single-clinician-to-single-patient video visits, patient joins via magic link with no app install. Audio feeds the existing Whisper + pyannote + TitaNet + Anthropic pipeline. Clinician sees the same capture flow as in-person visits, with a video tile attached.

**Full architectural spec lives in `telehealth-architecture-spec.md`** — covers video provider selection (recommends Daily.co), audio routing (browser-side WebRTC tap to Whisper), patient identity flow (magic link + DOB verification), recording / consent, network resilience, TitaNet integration, phased rollout, and cost analysis. This section covers the design language only.

**Critical UI design choices:**

- **Patient-side has a different visual language than clinician-side.** Warmer, friendlier, less clinical. Patient is at home, possibly on a phone, possibly anxious. Patient sees rounded cards, large readable type, friendly greetings ("Welcome, Jane").
- **Pre-call checks are the patient's first interaction.** Camera, microphone, network — each as a separate row with green check when good. Reduces support tickets ("I joined and they couldn't hear me").
- **Clinician info card on patient waiting screen.** Avatar + name + specialty + "Joining shortly" pulsing indicator. Humanizes the wait.
- **Consent is explicit and visible** — pre-checked but with the language plainly readable: "I consent to this visit being recorded for the purpose of generating my clinical note." Audit-logged.
- **Clinician in-call view = capture flow + video tile.** Same Live transcript / Live note panel from in-person capture, plus a video area in the upper left. Recording dot, timer, all the same affordances.
- **Dark theme on clinician in-call.** Reduces glare during a video call where the clinician is looking at the patient. The rest of the product is light theme; in-call is the one exception.
- **Footer status pill** mentions the active stack: "Whisper · pyannote · TitaNet" — useful for support diagnosis when something goes wrong, signals to the operator which models are running.

**Patient on mobile (primary):**

- Single-column, max-340 px effective width on phone
- Pre-call checks stack vertically with green checkmark per check
- Big primary "Join visit →" button at bottom (sticky)
- Consent row above CTA, can be unchecked (which disables the join button)

**Clinician on desktop (primary):**

- Two-column dark UI
- Left: Video tile (large, dominant) + in-call controls + live transcript
- Right: Section progress + live note (matches existing capture flow)
- End-visit transitions to the existing review/sign flow

**Engineering integration points** (more detail in the architecture spec):

- Browser-side `MediaStreamTrackProcessor` taps the patient's audio from Daily's WebRTC stream and pushes it to the existing Whisper WebSocket endpoint
- `TelehealthSession` table links the Daily room to the existing `Note` model
- Patient identity = magic link + DOB confirmation; no account creation
- TitaNet runs post-call as it does today; no telehealth-specific changes needed

### Marketing / signup landing (public face for new prospects)

The first impression for every new prospect arriving via search, ads, or referral. Currently a generic SaaS template with internal-team-speak copy, buried pricing, and zero mention of the product's most defensible differentiator (antihallucination flags).

**Goal:** Lead with the clinical value prop. Surface the differentiators. Make the pricing scannable. Drive trial signups.

**Critical changes:**

- **Replace the headline.** Current "Start with the OmniScribe workflow clinicians will actually use" is internal-team-speak. New: "Stay with your patients. The notes write themselves." — benefit-led, specific to clinical practice, emotionally resonant. Save 2+ hours per day named in the subhead.
- **Replace "Start free testing" with "Start free trial"** — convention users pattern-match to. The current phrasing is unusual and creates friction.
- **Remove the "Back Home" button on signup header.** User came TO this page; "Back" is wrong. Brand wordmark serves as the home link.
- **Add a live product preview below the hero.** Mini split-screen showing transcript + AI-drafted note. Show what the clinician gets before they scroll. Currently the page only describes; never shows.
- **Surface the trust signals.** HIPAA-ready · SOC 2 Type II · End-to-end encrypted · BAA available — as a strip immediately below the hero. Currently absent. These are the four phrases that close clinical buyers.
- **Antihallucination feature spotlight.** Your most defensible differentiator. Full section with the same flag-tier visual language used in-product (RED / BLUE / YELLOW). Headline: "We tell you when the AI got it wrong — before you sign." Visual continuity from marketing → product.
- **Three pricing cards with a "Most popular" recommended marker.** Solo / Team / Enterprise. Replaces the buried pricing-as-eyebrow approach.
- **Real testimonial with specificity.** Reference a customer who can speak to time saved + flags caught. The combination is the conversion driver.
- **Single-column, centered, max-width 600 px.** Modern marketing convention — easier to scan, works at any viewport. Replaces the two-column layout with sticky right-rail signup form.
- **Sentence-case headings throughout.** "How it works" / "What makes us different" / "Pricing" — friendly, not corporate.

**Content additions (over time, as engineering / customer base mature):**

- **90-second demo video** — replace the static product preview with a real screen capture of an encounter from start to signed note.
- **Customer logo wall** — "Used by clinicians at [logos]" once you have referenceable customers.
- **Specialty-specific landing variants** — `/medical`, `/rehab`, `/behavioral-health` with division-specific value props. Worth doing once any single specialty converts well.
- **FAQ section** — top 6 questions (EHR integration, hallucination trust, HIPAA compliance, network outage handling, setup time, data export).
- **Comparison pages** — `/vs-{competitor}` for each major scribe competitor. SEO + sales tool.

**Engineering notes:**

- The current page imports `OmniScribeAILanding` from `src/components/marketing/`. Refactor that component into smaller pieces matching the new sections (`<MarketingHero>`, `<ProductPreview>`, `<TrustSignals>`, `<HowItWorks>`, `<AntihallucinationSpotlight>`, `<PricingCards>`, `<Testimonial>`, `<MarketingFooter>`).
- Pricing data is already centralized in `lib/public-pricing.ts` (per the existing imports). Keep that as the source of truth; let cards consume it.
- Resolve the OmniScribe vs. Genscribe naming inconsistency before any marketing-page work ships. The marketing page is the single most damaging place for that bug.
- The signup form (currently at `/signup`) can stay as a separate route, or fold into the bottom of the marketing page as a final CTA. Either pattern works; the current two-page split is fine if `/signup` is similarly redesigned with the same component pieces.

### Ops Console (internal staff operations dashboard)

OmniScribe's internal engineering / ops / support / billing dashboard. Distinct from Owner Console (customer success) — Ops is for the company's own staff doing technical operations. Currently the layout exists but the Overview route doesn't have a meaningful real-time monitoring surface, and the 12-item flat sidebar nav lacks grouping.

**Goal:** Make Ops the company's nervous system. On-call engineers, support managers, billing ops, and content team should answer "is anything on fire?" in 5 seconds.

**Critical changes:**

- **Build a real Overview dashboard at `/ops/dashboard`.** Currently the route is a shell with no overview content. The new dashboard shows: live metrics row (Active encounters, Notes/hr, AI cost rate, Error rate, Queue depth), system health panel (per-service status with semantic dots), active incidents with severity, recent activity feed, AI cost monitoring with vendor breakdown.
- **Group the 12-item flat sidebar.** Current order: Overview, Organizations, Users, Subscriptions, Usage & Billing, Transactions, System Health, Audit Logs, Templates, Prompts, Announcements, Settings. Group into:
  - **Workspace:** Overview, System health, Incidents (new)
  - **Customers:** Organizations, Users, Subscriptions, Usage, Transactions
  - **Content:** Prompts, Templates, Announcements
  - **Compliance:** Audit logs, Settings
- **Distinct purple "Ops" mode pill.** Visually distinguishes Ops Console from Owner Console (also platform-level but framed as "Platform Owner") and tenant Admin (teal, "Org Admin"). Current label "Platform Admin" collides with all the other admin concepts in the product.
- **Live indicator with pulsing dot** in the Overview header. "Live · last refreshed 3 s ago." Auto-refresh every 5 s.
- **Cost monitoring panel.** Live AI cost rate ($/hr), 24h total, sparkline, vendor breakdown (Anthropic % · AssemblyAI %). Critical for engineering decisions about model choice, caching, throttling.
- **System health table with semantic dots + monospace data.** Green/amber/red per service plus actual signal (p95 latency, queue depth, connection count). Replaces opaque "everything is fine" with quantitative confidence.
- **Incidents list with severity.** P1/P2/P3 with color-coded left accents, duration, affected tenant scope. Empty state when 0 incidents reads "All systems operational."
- **Activity feed with event-type icons.** Deploys, plan changes, escalations, onboardings, announcements. Each row has an icon mapped to event class. Replaces the audit log as an at-a-glance feed; full audit is one click away.
- **Add Incidents page (new).** Currently System Health is the only ops/health surface. Add a dedicated `/ops/dashboard/incidents` for incident history, postmortem links, affected tenants, response timeline.
- **Other Ops pages follow the Admin Page Shell pattern** from Phase 16. Tables with filter chips, bulk actions, overflow menus. Same components.

**Engineering notes:**

- Real-time metrics need an aggregate endpoint (`/api/ops/overview`) returning a JSON payload. Cache with 5 s TTL; poll from the client. Server-Sent Events is overkill for non-conversational data.
- Per-call cost attribution requires a `platform_cost_events` table — Anthropic and AssemblyAI both expose per-call token/duration cost. Aggregate hourly. Without this, the cost panel is a placeholder.
- The pulse-dot animation is purely UI affordance — confirms the page is alive even when data hasn't changed.
- Most Ops pages share the AdminPageShell + AdminTable from Phase 16's foundation. Build those first; Ops pages are then trivial to scaffold.
- Audit logs page on Ops is unscoped (all tenants); the tenant-admin audit page from Phase 16 is org-scoped. Same component, different query.
- Prompts page is more complex than a table — it's effectively a versioned content management tool with A/B testing and rollback. Worth its own design pass when scoped.

### Remaining tenant admin pages (Sites · Seats · Voice · Billing · Audit)

These five pages follow the **Admin Page Shell** pattern derived from the Team page redesign. Rather than designing each individually, define the shared shell as a reusable component and let each page slot specific content into it. Currently each page reinvents the structure with hardcoded colors, inconsistent header sizes, and divergent action patterns.

**The shared Admin Page Shell:**

1. Shell breadcrumb header (Administration / [Page] · Org Admin pill).
2. Page header: title at 22 px + subtitle with one-line summary of key counts + actions row (search, secondary buttons, primary CTA).
3. Optional capacity / overview strip below header (some pages have this — Seats, Billing — others don't).
4. Filter chip row (Status + secondary classification, both labeled).
5. Table with checkbox column, content cells, status pill, action menu.
6. Bulk-action contextual bar that appears when rows are selected.
7. Empty state when no rows match (same icon + headline + helper + CTA pattern).
8. `<AlertDialog>` for any destructive action — never native `confirm()`.

**Page-specific content:**

**Seats:**
- Capacity strip up top: total assigned (with bar), tier breakdown (Pro / Standard counts), next-charge date.
- Filter chips: Status (All / Assigned / Unassigned / Expiring) + Tier (Pro / Standard).
- Table columns: Seat tier + ID, Assigned user, Expires (with countdown for expiring), Status, Actions.
- Replace the popover-on-chip seat-assignment pattern from current Team page with inline column.
- Bulk actions: Revoke selected, Reassign to user, Extend expiration.
- Primary CTA: "+ Assign seat" (opens user picker sheet).

**Sites:**
- Page subtitle covers summary ("3 sites · 8 departments · 24 active members").
- Filter chips: All / Active / Archived.
- Table columns: Name + address, Members, Departments, Created, Status, Actions.
- Primary CTA: "+ New site." Each row links to a site detail page (`/admin/sites/[id]`) for managing that site's departments and members.
- Bulk action: Archive multiple sites.

**Departments:**
- Filter chips: All / By site (cascading select).
- Table columns: Name + parent site, Members, Lead, Specialty, Status, Actions.
- Primary CTA: "+ New department."

**Voice:**
- Settings page (no table) — same two-column pattern as Documentation defaults.
- Left column sections: Speaker color preferences, Dictation defaults (auto-punctuation, profanity filter, silence threshold), Voice prints (per-clinician voice library for auto-recognition), Audio quality (sample rate, bitrate, retention period).
- Right column: live preview of a sample transcript with current voice settings.
- Same "Test with my voice" upload affordance pattern.

**Billing:**
- Hybrid pattern: subscription overview card + invoices table.
- Hero: Plan name + active pill, MRR with breakdown (5 Pro × $199 + 7 Standard × $99 = $1,488), next charge date, "Change plan →" link.
- Mini-stats panel: Payment method, Billed-to email, Tax ID.
- Tabs: Invoices · Usage · Payment methods · Settings.
- Invoices tab: Table with Invoice number, Description, Date, Status pill, Amount, PDF download per row.
- Status pills: Paid / Due / Failed (tokenized).
- Primary CTA in header: "Update payment."
- Replace `confirm()` for any cancel-subscription or remove-card action with `<AlertDialog>`.

**Audit (new page — currently doesn't exist as a tenant admin route):**
- Add `/admin/audit` so org admins can see their *own* org's audit log (currently only platform Ops staff have an audit view at `/ops/(authenticated)/dashboard/audit`).
- Critical for HIPAA compliance audits and incident investigation.
- Table columns: Timestamp, Actor (with avatar), Action verb, Target, IP address, Details.
- Filter chips: Action type (Auth / Clinical / Admin / Billing) + Date range.
- Search by actor name or target ID.
- Export to CSV for compliance review.
- Read-only — no actions per row except "Show details" (opens a sheet with the full event payload).

**Engineering notes:**

- Build `<AdminPageShell>` and `<AdminTable>` shared components in Phase 0 (foundation). All six pages then become slot consumers — Sites and Departments are the simplest implementations; Seats has the capacity strip variant; Billing has the hybrid overview + tabs.
- The capacity-strip section uses the same progress-bar component as the Plan of Care card in the rehab patient detail page (consistent pattern across the product).
- Bulk actions need a transactional API endpoint per resource type. Same pattern as the bulk-sign API for drafts (Phase 7).
- Audit log already exists in the data model (audit writes per .cursorrules rule 8); just needs a UI surface scoped to org instead of platform.
- Voice page's "voice prints" feature requires speaker-embedding storage per clinician — this is a research/integration question with AssemblyAI and may be out of scope for a UI-only redesign.

### Owner Console (multi-tenant platform owner surface)

The platform owner's cockpit. Currently a single `/owner` route with hash-anchored sections (Organizations, Support, Commercial, Platform Context), card-based tenant list, hardcoded status colors, and no real tenant detail surface. Doesn't capture the metrics an owner actually cares about (MRR, churn risk, trial conversion, expansion potential).

**Goal:** Make this a real SaaS operations cockpit — health-monitor, support queue, commercial intelligence, and tenant-entry workflow.

**Critical changes:**

- **Split the single page into discrete routes.**
  - `/owner` — Dashboard (overview metrics, top tenants by health, recent activity feed)
  - `/owner/organizations` — Organizations list (table with filters, sortable columns, sparkline activity)
  - `/owner/support` — Support queue (tenants with open tickets, prioritized by severity + tier)
  - `/owner/commercial` — Subscription / billing intel (MRR breakdown, churn cohorts, expansion candidates, trial-conversion funnel)
  - `/owner/[orgId]` — **Tenant detail page (new, currently doesn't exist).** Health summary, billing details, contacts, support history, plan changes, audit log, "Enter as admin →" as the primary action. Replaces the "everything on one page with hash anchors" pattern.

- **Replace card-based org list with a real table.** Same density argument as the admin Team page — owners managing N tenants want to scan many at once. Columns: Org · Plan · MRR · Seats · Activity (30-day sparkline) · Status · Action.

- **Add platform-level metrics that matter.** Currently the top metrics show administrative gaps (pending invites, unassigned seats). Replace with SaaS metrics: Active orgs, MRR (with trend), Trials ending this week, Support backlog (with escalation count), Total seats sold (with utilization).

- **Per-tenant activity sparkline.** Inline 7-day bar chart of note volume. A healthy tenant has flat-or-rising bars; a churning tenant has a visibly declining slope. Sortable as a column ("show me tenants with the steepest drop").

- **Health status combines multiple signals into one pill.** "Healthy" / "Needs attention" / "At risk" — a composite score from recent activity, support ticket count, trial state, seat utilization, setup gaps. Each pill has a one-line subtitle explaining *why* it's that status.

- **Three-tier left accent for visual triage.** Red = at risk, amber = needs attention, green = healthy, transparent = neutral. Matches the visual rhythm of drafts list and admin team page.

- **Filter chips for Plan and Health status.** Currently only search. Owners need to view "all trials" or "all at-risk" as one-click filters.

- **One action button per row.** "Open →" goes to `/owner/[orgId]`. The tenant detail page hosts the "Enter as admin →" + Open Support + view billing affordances. Replaces the dual-button "Open Support / Enter Admin Context" confusion.

- **Mode pill in breadcrumb is purple-toned** (distinct from teal Org Admin / Site Admin pills) so the owner instantly sees "you're in elevated context."

- **Tokenize all status colors.** `bg-amber-50 text-amber-700/80`, `bg-blue-50 text-blue-700/75`, `bg-green-50 text-green-700/70` → `--status-warning / --status-info / --status-success`.

**Tenant detail page (`/owner/[orgId]`) — new surface:**

- **Top:** Org header (name + plan + status pill) + key metrics (MRR, seats, last active, NPS if collected).
- **Tabs:** Overview · Billing · Team · Activity · Support · Audit.
  - Overview: health summary, key contacts, plan details, primary action ("Enter as admin →").
  - Billing: subscription state, MRR over time, payment method, invoices.
  - Team: list of admins/clinicians with last-seen.
  - Activity: timeline of org-level events (new members, seat changes, plan upgrades, recent support contacts).
  - Support: open and closed tickets, NPS responses, conversation log.
  - Audit: every owner-mode action taken on this tenant (who entered as admin, when, for how long, what they did).

**Engineering notes:**

- Health score computation runs server-side on a cron + invalidates on relevant events (note signed, ticket opened, trial state change). Cache for ~5 min.
- Activity sparkline data is pre-aggregated (daily note counts for the last 30 days, stored as a `int[]` on `Org.activityHistory` or computed on query with caching).
- Splitting the page into routes is a substantial refactor — current single-page approach with hash anchors needs to become a real Next.js routing structure.
- Tenant detail's `Audit` tab queries the existing audit log (per .cursorrules rule 8). Owner-mode actions should be especially visible since they're highest-trust operations.
- Stripe-linked subscription data should sync nightly (or webhook-driven) into a denormalized `Org.commercial` field for fast list rendering.

### Sign / signature flow (the most consequential action in the product)

The moment a note becomes a permanent legal record. Currently the only barrier is **typing your name into a text input**. For an action that's billable, audit-traced, and protected under licensure, this is dramatically under-spec'd. Plus the page shows zero note content (no preview), no attestation language, and uses a custom black-overlay modal for goal verification.

**Goal:** Make signing feel deliberate, secure, and ceremonious. Reduce the chance of wrong-note signings without adding tedium for the common case.

**Critical changes:**

- **Three signature methods with biometric as primary.** Touch ID / Face ID / Windows Hello via WebAuthn is the recommended primary path — fast, phishing-resistant, and modern expectation for high-stakes actions. The 4-digit signing PIN as secondary (the sign-time re-auth mechanism, with a time-boxed unlock window). Type-your-name stays as a legacy fallback for orgs/users that require it. Currently type-name is the *only* method.
- **Note preview collapsible on the sign page.** "Show full note ↗" expands. Currently the sign page shows zero note content — clinician has to navigate back to verify. Inline preview gives an at-a-glance check.
- **Attestation language with explicit checkbox.** "I attest that this note accurately reflects the encounter and is consistent with my professional licensure and scope of practice." Required by many state licensure boards. Active acknowledgment, not passive.
- **Step indicator** (3 of 3) frames signing as the final step in a deliberate workflow.
- **Replace custom black-overlay modal** for goal verification with `<AlertDialog>`. Same anti-pattern that appears across the codebase.
- **Tokenize all hardcoded colors.** `border-amber-500/30 bg-amber-500/5 text-amber-900` for sibling warnings → `--color-background-warning`/`--color-text-warning`. Hardcoded shadow magic numbers on success checkmark → standard token-driven styling.
- **Adaptive button language.** "Sign both notes with Touch ID" / "Sign with PIN" / "Sign with typed signature" — the button promises exactly what's about to happen. Currently always says "Sign Note" regardless of context.

**Critical changes — Success state:**

- **Calmer hierarchy.** Currently 4 buttons compete for attention (Copy Note loud + Patient Instructions + Referral Letter + Done). Redesign demotes Copy / Instructions / Referral to "Optional next steps" rows; one big Done button at the bottom.
- **Note ID + Locked pill.** Surfaces a unique identifier (e.g., `NX-2026-04823-A · ● Locked`). Gives the moment permanence; useful for support and audit references. Currently no note ID is surfaced anywhere.
- **"Permanent record" framing.** Replaces "This note is locked. Copy it to paste into your EHR." with milestone-first language ("Note signed · Permanent record"), action-second.
- **Quieter success icon.** Tinted teal halo + filled checkmark using design tokens. Replaces the multi-layer `shadow-[0_10px_24px_-8px_rgba(10,132,255,0.35)...]` magic numbers.

**Future enhancements (worth scoping separately):**

- **Witness / co-signature workflow.** Some workflows require a co-signer (physician overseeing NP/PA, attending overseeing resident). Add "Send for co-sign" path with a notification to the assigned co-signer; their sign step has the same biometric/PIN options. Audit log captures both signatures.
- **Auto-transmit to EHR.** If the org has an EHR integration, the success state shows "Sent to Epic at 3:14 PM ✓" instead of leaving the clinician to copy-paste.
- **Decline / kick-back path.** "Save as needs more work" with a reason field — for cases when the clinician realizes mid-sign that the note isn't ready.
- **Step-up auth based on session age.** If WebAuthn was used to sign in within the last N minutes, trust it for sign. If session is older, require re-auth. Adds friction only when the risk is real.

**Engineering notes:**

- Biometric signing requires WebAuthn registration during onboarding. Add a flow to `/admin/security` for users to register fingerprint/face credentials, with a fallback to QR-code enrollment via mobile.
- Note ID format suggestion: `NX-YYYY-{mrn}-{seq}` where `seq` differentiates sibling notes from the same encounter. Generate at sign time, immutable.
- Attestation text should be configurable per organization (legal language varies by state and licensure body). Pull from `org.attestationText` with a sensible default.
- The `/sign/[noteId]` page is currently 668 lines. Worth a refactor during the redesign: extract `<SignSummary>`, `<SignatureMethodPicker>`, `<SignAttestation>`, `<SignSuccessState>`, `<GoalVerificationDialog>` (using `<AlertDialog>`).
- Goal verification modal already exists conceptually — keep the logic, swap the modal pattern.

### Auth flow (login, register, signup)

The first impression for every user. Small surface area but high-stakes — a clinician evaluating OmniScribe via a marketing link sees this page first. Authentication is email + password only (no MFA/two-factor; sign-time re-auth uses the 4-digit signing PIN, covered in the Sign flow section). Currently the login page is missing standard affordances (Forgot password, password visibility toggle).

**Goal:** Look like a polished, trusted clinical product on first paint. Make recovery paths obvious. Match modern auth UX (autofill, magic link).

**Critical changes — Login:**

- **Replace `text-red-600/70` error styling with tokenized `<ErrorBanner>`** using `--color-background-danger` + full-opacity `--color-text-danger`. Reads as a real alert, not a hint.
- **Sentence-case labels** ("Email", "Password"). Currently `text-[11px] uppercase tracking-[0.12em]` — overly formal, inconsistent with the rest of the redesigned product.
- **Forgot password link** inline with the password label. Required for any v1 auth surface.
- **Password visibility toggle** (eye icon in input trailing edge). Tap to reveal. Standard expectation.
- **"Keep me signed in on this device" checkbox.** Default off. Explicit about scope so clinicians on shared workstations don't accidentally persist sessions.
- **Magic link as secondary action** ("Email me a sign-in link") below the primary Sign in button. Phishing-resistant alternative.
- **Trust signal chips below the card** — "HIPAA-ready · SOC 2 Type II · End-to-end encrypted." Answers the most common security objections at a glance.
- **Loading state shows a spinner**, not just "Signing in..." text. Visible feedback for slow networks.
- **Replace "Start free testing"** with "Start a free trial" — convention users pattern-match to.
- **Rate-limit lockout messaging** — "Too many attempts. Try again in 5 minutes." Currently absent from code.

**Critical changes — Signing PIN (set + verify):**

- **Four separate digit boxes** instead of a single input with a `letter-spacing` trick. Auto-advance on input, paste dispatches across all four, screen readers announce position properly.
- **Clear unlock-window framing.** After a successful PIN entry, signing stays unlocked for a time-boxed window; the UI should state how long the window lasts so re-entry doesn't feel arbitrary.
- **"Forgot your PIN? Reset it"** affordance. The PIN can be re-set from the profile surface; surface a path when the clinician blanks at sign time.
- **Same card wrapper as Login.** Reuse the `rounded-[28px] border bg-card/95 shadow-xl` container so the PIN setup/verify screens match the rest of the auth flow.

**Critical changes — Layout consistency:**

- All auth pages (Login, Register, Forgot, Reset) and the signing-PIN setup/verify screens share the same `AuthLayout` card structure with the same header (brand + contextual subtitle).
- Header subtitle is contextual per page: Login = "Sign in to continue to your workspace"; Register = "Create your workspace"; Forgot = "Recover your account"; Signing PIN = "Confirm it's you to sign."

**Future enhancements:**

- **SSO buttons** (Google / Microsoft / Apple) — many clinical orgs require SSO for compliance. Discoverable via the email field — type a corporate email, SSO options appear conditionally.
- **Account lockout self-service** — "I lost my device" link triggers an admin-mediated identity verification flow.
- **Passkey support** — passwordless via WebAuthn for users who set it up.

**Engineering notes:**

- The `text-red-600/70` error pattern appears in 6+ files across the codebase. Phase 0 (design tokens) replaces all of them with the `<ErrorBanner>` component or `text-destructive`.
- A per-digit signing-PIN input is a common React pattern — use `react-otp-input` or build a small `<OtpInput>` component (four cells for the PIN). Each box has `inputMode="numeric"`, `maxLength={1}`, `autoComplete="one-time-code"` so native autofill triggers.
- Trust signals should be data-driven, not hardcoded. Pull from a config: orgs without SOC 2 attestation shouldn't show that pill.
- Magic link backend already exists if NextAuth.js v5 email provider is configured — UI just exposes it.

### Flag review panel — antihallucination feature

The product's most distinctive safety feature. Already exists at `/src/components/review/flag-review-panel.tsx` with a strong conceptual model — three-tier confidence taxonomy (RED contradicts transcript / BLUE adds specifics / YELLOW infers), AI-assisted fixes, batch resolutions for low-stakes tiers, and a one-flag-at-a-time review workflow. The redesign keeps the bones and fixes the implementation.

**Goal:** Make RED flags impossible to ignore, give the AI fix a clear promise, and capture feedback when flags are wrong so the model can improve over time.

**Critical changes:**

- **Tokenize all hardcoded hex colors.** `#E24B4A`, `#378ADD`, `#EF9F27` (foregrounds) and `#FCEBEB`, `#E6F1FB`, `#FAEEDA` (backgrounds) become `--status-danger / --status-info / --status-warning` design tokens. Auto-adapts to dark mode; currently the panel breaks in dark mode entirely.
- **Remove emojis from buttons.** `⚡ AI Fix This`, `⚡ AI Clarify This`, `✓ Yes, confirmed — keep` become Lucide icons + descriptive labels.
- **RED gets visual dominance.** Currently all three tiers render as parallel chips of equal weight. RED card becomes larger (14 px padding vs 10 px), with a 22 px count (vs 18 px), animated pulsing dot, and a stronger left border. BLUE and YELLOW become supporting, not equal-weight.
- **Better button language.** "Replace with what was actually said" instead of "AI Fix This." "Trim to what the transcript supports" instead of "Remove specifics." The clinician should know what the AI is about to do before tapping.
- **Diff preview integrated into the flag card.** Currently before/after diff appears as a separate state after pressing AI Fix. Show the suggested fix inline so the clinician can read both versions before committing. Single Accept-equivalent action.
- **Transcript evidence as a proper quote.** Left-border quote with the transcript line + speaker + timestamp + "Jump to source →" that scrolls the transcript panel to that turn. Same bidirectional linking pattern as the review screen AI alert.
- **Section grouping in the summary view.** Below the tier counts, a "By section" card shows which note sections have which flag types ("Plan: 2 RED · 1 BLUE · Assessment: 1 YELLOW"). Helps the clinician decide where to start.
- **Section chip in the active review header.** Progress bar shows "1 of 7" plus the current section ("Plan") as a chip. As they advance through sections, the chip updates so they know where they are structurally.
- **"Report incorrect flag" feedback link** at the bottom of every flag card. Tapping logs the flag as incorrect (separate from accept/dismiss) and feeds into a precision metric. Without this signal, accept/dismiss confounds "good flag, fixed" with "bad flag, ignored" — the team can't tune the model.
- **Tier explanation entry point** as a single "What do these mean?" link in the header, replacing the per-chip popover-on-click pattern. Most users won't click individual chips; one prominent link makes the taxonomy discoverable on first encounter.

**Engineering notes:**

- The `flag-review-panel.tsx` component is ~900 lines. Worth a refactor into smaller pieces during the redesign: `<FlagSummary>`, `<FlagActiveCard>`, `<FlagDiffPreview>`, `<FlagBatchPrompt>`, `<FlagResolved>`. Each can be tested in isolation.
- Add a `markIncorrect` resolution type alongside `accepted / dismissed / kept / edited / ai_autofix / removed`. Server-side, log incorrect flags separately for model evaluation.
- The "Jump to source" affordance requires the transcript panel to be scrollable to specific turn IDs. Add `data-turn-id={turn.id}` attributes on each utterance and `scrollIntoView()` from the flag card.
- Tier explanation popover content (`TIER_EXPLANATIONS`) stays — same content, different invocation point.
- Bulk fix for related REDs is a future enhancement: add a `/api/notes/[id]/batch-fix-flags` endpoint that takes an array of flag IDs and applies a single grouped fix when the model detects clustered flags (same root cause).
- Confidence threshold per org becomes an org setting on the Documentation defaults page: "Minimum confidence to flag (RED ≥0.85 / BLUE ≥0.7 / YELLOW ≥0.6)" — tunable per organization based on false-positive tolerance.

### Admin dashboard + Team page (admin / owner surface)

The org-management cockpit. Currently a series of CRUD lists with no overview, hardcoded role/status colors, no filtering, no bulk actions, no usage signal, and an inline edit form that replaces the entire page header.

**Goal:** Org admins answer "is anything off this month?" in 5 seconds, then dive into the right management surface in 1 click.

**Critical changes — Admin shell:**

- **Add a real Overview dashboard at `/admin`.** Currently the admin landing redirects into a nav section. The new overview shows four key metrics at the top (Active members, Seats assigned, Notes this month, Time to sign), each with a trend delta. Below: recent activity feed (joins, signed notes, template updates, expiring certs) and seat utilization with tier breakdown + top users by note count.
- **Org switcher in the top-right of the shell.** "OmniScribe Demo Org ▾" — for owner-mode users supporting multiple tenants, this is the canonical place to switch context. Replaces the awkward "Exit to Owner Console" back-link pattern.
- **Tokenize all hardcoded role/status colors.** `bg-red-50 text-red-700/70`, `bg-purple-50`, `bg-blue-50`, `bg-green-50`, `bg-amber-50` etc. all become `--status-*` and `--source-*` design tokens.

**Critical changes — Team page:**

- **Replace inline cards with a real table.** Currently each member is a card with a 5-column metadata grid — generous space for 3–4 visible members per screen. Table-aligned rows let admins scan 10+ members per screen, which is the actual scale they manage.
- **Unify pending invites with active members.** Currently a separate section. Treat invites as another `Status` value ("Invited · Sent 3 days ago") in the same column where active members show "Active · Last seen 2 h ago." One mental model, one list.
- **Filter chips alongside search.** Status (All / Active / Pending / Deactivated) + Role (Clinician / Site admin / Org admin). Currently search is the only way to slice the list.
- **"Last seen" / activity signal in the Status column.** "Active · Last seen 2 h ago" / "Last seen yesterday" / "Last seen 3 days ago." Idle seats are wasted capacity — make it visible.
- **Seat assignment as inline column, not popover.** "Pro · May 28" sits in its own column. Click-to-edit can still open the popover for assignment changes; the default is read-only inline.
- **Bulk select with multi-action.** Checkbox column + actions in a contextual bar that appears when N rows are selected: Deactivate · Reassign to site · Revoke seats · Resend invites. Onboarding 10 staff or offboarding a contract team becomes batch instead of per-member tedium.
- **Edit moves to a `<Sheet>`, not an inline form.** Currently clicking Edit replaces the top of the page with a heavy form. Sheet slide-in keeps the table visible and lets the admin reference other rows while editing.
- **Replace native `confirm()` for any destructive admin action with `<AlertDialog>`** matching the dialog pattern used elsewhere.

**Responsive behavior:**

- **Desktop (≥1280 px):** Sidebar at 220 px, full 5-column table (Member · Role · Site/Dept · Seat · Status · Actions). All filter chip groups labeled.
- **Tablet landscape (~1024 px):** Sidebar at 180 px, table collapses to 4 columns — Site/Dept folds into the Member cell as the second line (replaces email). Edit button collapses into overflow `⋯` (touch-friendlier). Stats strip drops; counts move to page subtitle. Filter labels drop, chips become unlabeled.
- **Tablet portrait + mobile (<900 px):** Sidebar collapses to a slide-out drawer triggered by a hamburger icon top-left. Table becomes stacked cards (similar to current pattern but cleaned up). Bulk-select stays available via long-press.

**Engineering notes:**

- Overview dashboard requires aggregate query endpoints: `/api/admin/overview/metrics`, `/api/admin/overview/activity`, `/api/admin/overview/top-users`. Cache 5–10 min; metrics don't change rapidly.
- "Last seen" requires tracking per-user activity timestamps (route entry, note generation, sign action). Add `Membership.lastSeenAt` field.
- Bulk actions need a transactional API endpoint that accepts an array of membership IDs + an action verb. Either succeeds atomically or fails the whole batch.
- The same Team page serves Site Admins (scoped to their site) and Org Admins (full org view). Use `canManageTeam` from the existing admin shell context to gate destructive actions.
- Owner Console (multi-tenant view at `/owner`) follows the same pattern but one level higher: tenants list instead of members list, with metrics columns (members · seats sold · MRR · support flags) and an "Enter as admin →" action that navigates into the tenant's admin view with the impersonation banner.

### Templates manage + editor (admin power-user surface)

The screen where clinic admins, lead clinicians, and team leads design how every clinical note will look. Currently a basic CRUD list with a constrained modal editor. The redesign treats templates as designed artifacts, not configuration objects.

**Goal (manage list):** Find, scan, and triage 20+ templates by source, division, and usage in seconds.

**Goal (editor):** Design a template with a live preview side-by-side. AI guidance — the field that most directly shapes generation quality — is reachable in one click, not three.

**Critical changes — manage list:**

- **Drop the tab pattern (System Presets / Custom).** Replace with filter chips for Source (All / My / Team / Presets / Community) and Division (All / Medical / Rehab / BH). Lets admins combine filters and see the full library at once.
- **Add a search bar.** Match name, division, profession. Required at scale (clinics often have 30+ templates).
- **Section preview as inline chips.** "Subjective · Objective · Assessment · Plan" instead of "5 sections." An admin can tell SOAP from DAP from a structured intake at a glance.
- **Usage signal per row.** "142 / mo" or "Never used." Tells admins which templates are core infrastructure vs. dead weight.
- **Last edited with author.** "Apr 18 · Dr. Patel." Critical for governance — tells admins who maintains what.
- **Source as a colored chip with semantic meaning.** Preset (muted teal), CMS Default (success green), Team (info blue), My template (purple), Community (pink). Scannable in a list of 23 templates.
- **3px left-accent for source classification.** Subtle teal for Preset, success green for CMS Default, transparent for everything else. Adds visual rhythm.
- **Edit + overflow menu replaces 4 icon-only actions.** "Edit" labeled button (most common). Overflow `⋯` opens labeled actions: Clone, View JSON, Share, Move to Team, Archive, Delete. Touch-friendly for tablet.
- **Bigger page heading.** "Templates" at 22px (matching Drafts), with "23 active · 3 divisions · 4 sources" subtitle. Currently `text-lg` (18px) — feels minor compared to other top-level pages.
- **Replace native `confirm()` with `<AlertDialog>`** for delete.
- **Replace hardcoded `bg-blue-50 / bg-green-50 / bg-purple-50` with `--status-*` and `--source-*` design tokens.**

**Critical changes — editor:**

- **Replace the modal with a full-page editor.** Editing a template is a meaty design task. A `Dialog` capped at `max-w-2xl max-h-[90vh]` is the wrong container. Full page lets admins reference the template list, see usage data alongside, and use the full screen for the live preview.
- **Live preview pane on the right (~45%).** Renders a sample AI-generated note using the current template structure against a stock transcript. Updates as the admin edits sections, toggles bullet/paragraph, or rewrites AI guidance. Configuring blind is gone.
- **Sample transcript switcher.** Dropdown above the preview lets admins try the template against different encounter shapes (routine follow-up, new patient, complex multi-issue) to see how the structure holds up. Long-term: "Test against my last patient's transcript" for real-world validation.
- **AI guidance moves to the second row of every expanded section.** Previously buried inside `Advanced` toggle inside expanded section. This is the single most important field for output quality and should never have been hidden.
- **Bucket labels become editable.** "Subjective / Objective / Assessment & Plan" was hard-coded in the existing editor, forcing SOAP onto every template. Behavioral health uses DAP. PT uses different structures. The bucket label becomes a `Rename` action; `+ Add bucket` allows non-SOAP layouts. The data model already supports this.
- **Tabs split the four jobs.** Structure (visible by default), AI guidance (focused view of every section's prompt — useful for prompt-engineering passes across the whole template), Preview (full-screen preview without editor), Settings (name, division, profession, visibility, status, CMS flags).
- **Editable title in the breadcrumb.** "Templates / [name]" — clicking the name turns it into an inline input. No buried "Template Name" field.
- **Real drag-to-reorder on the grip handle.** Currently `GripVertical` is a misleading affordance — actual reordering is via up/down chevrons in expanded state. Make the grip do what it implies; remove the chevrons.
- **Demote or remove the section Type select.** Currently shows 4 options (Rich Text / Structured Fields / Checklist / Scale) but only `rich_text` is rendered in production. Either invest in the other types or delete the option. Don't ship dead UI.
- **Autosave with explicit "Saved" indicator.** "Saved 2 min ago" + ● dot in the top bar. Replaces the all-or-nothing Save Template button. Discard button reverts unsaved changes; Save & close exits.
- **Section snippet library (post-launch).** A sidebar drawer for reusable section blocks ("Vital Signs," "PHQ-9 Score") shared across templates. Reduces template-creation cost from 30 minutes to 5.
- **Diff view for preset overrides (post-launch).** When a clinician customizes a system preset, show what changed vs. canonical. Helps keep custom versions in sync as system presets get updated.

**Engineering notes:**

- The full-page editor route can replace the existing `manage-templates/[id]/page.tsx` (currently the inspect-only detail page). Edit is the primary action; inspect-only doesn't need its own surface.
- Live preview requires a `/api/templates/[id]/preview` endpoint that runs the current draft template structure against a sample (or specified) transcript through the LLM abstraction layer. Cache aggressively — templates don't change rapidly.
- Autosave should debounce ~1500ms after last keystroke and respect optimistic concurrency (PATCH with `If-Match: <updatedAt>` header to prevent overwriting another admin's concurrent edit).
- Bucket schema needs a small data migration: add `bucketLabel` field to `schema.buckets[]` so renaming sticks. Default to existing `BUCKET_LABELS` map when absent.

### Drafts list (mobile + desktop)

The screen every clinician hits first thing every morning. Triage tool, not a queue browser.

**Goal:** Answer the question "what needs my attention right now?" in under 3 seconds. Make signing 8 reviewed notes a single batch action.

**Critical changes from current state:**

- **Reorder buckets to match clinical priority.** Currently Preparing → In Progress → Processing → Ready for Review (engineering pipeline order). Should be **Ready to sign → In progress → Processing → (Preparing hidden or demoted)**. Triage first.
- **Page heading becomes a live summary.** "3 to sign · 2 in progress" instead of generic "Drafts." The count is the answer the clinician came for.
- **Bulk sign action.** Multi-select on Ready-to-sign items, single "Sign N reviewed" button that opens one biometric/PIN confirmation listing all the patients. Could save 30 seconds per session.
- **Aging chips on stale notes.** Today / 2 days / 7+ days, color-coded. Thresholds align with the org's late-note-signing policy. Late notes have compliance consequences — visual urgency must match.
- **Richer cards with patient identity.** DOB and MRN visible without tapping in. Two patients with the same first/last name happen daily.
- **Action button hierarchy by bucket.** Ready-to-sign uses primary "Review & sign." In-progress uses outline "Resume." Processing uses ghost "View." Hierarchy reflects actionability.
- **Search bar.** Match by patient name, MRN, date, template, visit type. ⌘K on desktop.
- **Filter chips.** Today / Week / All by date range, plus In-person / Telehealth, plus All clinicians (admin/multi-clinician contexts).
- **Replace inline delete confirm with `<AlertDialog>`.** Match the dialog pattern used everywhere else.
- **Mobile swipe-to-delete.** Natural pattern; same `<AlertDialog>` confirmation modal afterward.
- **"Preparing" bucket is mostly noise.** A note is in PREPARING for <10 seconds normally — anything older is an abandoned setup. Auto-clean PREPARING notes >24h old, or hide behind a "show abandoned" filter. Don't surface them in default view.

**Engineering notes:**

- The bucket reordering is a 5-line change to `BUCKETS` array order in `drafts/page.tsx`.
- Bulk sign requires a new API endpoint that accepts an array of note IDs, validates all are in REVIEWED status, and signs them atomically (or fails the whole batch).
- Aging chips need a server-side or client-side computation against `updatedAt`. Threshold values come from org settings.
- Search likely needs a backend endpoint; client-side filter only works for small drafts lists.

## The fixes from the original critique that this spec addresses

| Critique finding | Where it's addressed |
|---|---|
| OmniScribe vs. Genscribe naming | Design tokens section, "non-negotiable" |
| Goal status uses color only | Design tokens (status colors) — add icons in any pill |
| Hardcoded badge colors on Drafts | Replaced by `--status-*` tokens used everywhere |
| Low-contrast error text | Standardize on `text-destructive` full opacity |
| Sheet-inside-sheet on capture | Eliminated by moving setup to prepare screen |
| Native `confirm()` for leave | Replaced with AlertDialog throughout |
| Recording status in 4–5 places | Single header status, principle #1 |
| Inverted button polarity | Principle #3, sized into all mockups |
| Setup blocking the encounter | Moved to prepare screen, capture shows compact summary only |
| Width-jump on Start drafting | 250ms animated transition |
| 2,245-line monolith | Required refactor for any of this to be implementable cleanly |

## Implementation roadmap

Phased so the team can ship value incrementally rather than gating everything on the big refactor.

### Phase 0 — Foundation (sprint 1)

**Goal:** Make the design tokens exist so every subsequent change uses them.

- Define `--text-*`, `--space-*`, `--status-*`, `--speaker-*` tokens in `globals.css`
- Add ESLint rule banning arbitrary `text-[Npx]` and `bg-{amber|blue|green}-*` for badges
- Pick one product name and search-replace
- Build `<StatusBadge>`, `<StatusBanner>`, `<Label>`, `<RecordingStatus>` shared components
- Replace native `confirm()` calls with `<AlertDialog>` (capture leave, drafts delete, prepare cancel)
- **No user-visible feature changes yet.** Pure groundwork.

### Phase 1 — Highest-leverage user-facing wins (sprint 2)

**Goal:** Visible polish improvements on the screens already in production.

- Inverted button polarity on capture (Start drafting loud, Finish quiet)
- Add audio level meter to recording status pill
- Bump patient identity meta to full text contrast across all screens (safety-critical)
- Replace hardcoded badge colors with `<StatusBadge>` everywhere
- Touch target audit: bump all `h-7` clickable elements to `h-11` (44px) minimum

These are roughly 1 sprint of work and individually each is 1–4 hours.

### Phase 2 — The capture refactor (sprints 3–4)

**Goal:** Make the rest of the redesign possible.

- Break `src/app/(clinical)/capture/[noteId]/page.tsx` into ~7 focused modules (`useRecordingStream`, `useCapturePipelineStatus`, `<TranscriptPanel>`, `<RecordingControls>`, `<DesktopCaptureLayout>`, `<MobileCaptureLayout>`)
- Consolidate recording status to the header only; remove duplicate displays in CaptureHeader, LiveNotePanel
- Animate the panel-width transition on Start drafting (250ms)
- Auto-switch active tab to Live note when drafting starts (mobile)
- Add update-dot pattern to inactive tabs

**No user-visible features are added in this phase, but every subsequent phase becomes 5x cheaper.**

### Phase 3 — Move setup to prepare (sprint 5)

**Goal:** Remove the biggest UX friction during the encounter.

- Server-side: when a note is created in PREPARING status, pre-fill setup from the patient's last signed note
- Mobile prepare screen redesign: prior context card + setup card + single CTA
- Compact setup summary on capture screen (just a 2-line summary + "Adjust" link)
- Remove the heavy setup form from capture; reachable only via Adjust sheet

### Phase 4 — Section progress + per-section regenerate (sprint 6)

**Goal:** Coverage check + lightweight error recovery during/after drafting.

- Build `<SectionProgressStrip>` shared component
- Plumb section state from live-note store (already exists)
- Sticky position inside Live note tab on mobile
- Per-section regenerate (`↻` button per section) — calls existing live-generation API for that section only

### Phase 5 — Review screen redesign (sprints 7–8)

**Goal:** The longest-tail value. This is where clinicians spend the most time.

- Inline edit per section (no route navigation)
- Per-section reviewed status with auto-mark on edit
- Tap-to-source action sheet on long-press
- AI alert system: model-side self-critique pass, surface UI for flagged issues, source linking
- Speaker assignment with propagation
- Bidirectional source highlighting (desktop)
- Transcript search

### Phase 6 — Tablet landscape / desktop bonuses (sprint 9)

**Goal:** Honor the 20% desktop minority with the simultaneity their wide screens enable.

- Split layouts for capture and review behind the 900px breakpoint
- Prior context peek rail on capture
- Side-by-side note + transcript on review

### Phase 7 — Drafts list redesign (sprint 10)

**Goal:** Make the daily triage screen actually triage.

- Reorder buckets (5-line change)
- Page heading as live summary
- Aging chips with org-configurable thresholds
- Bulk-sign API + UI (multi-select + batch confirmation modal)
- Search backend endpoint + client UI
- Filter chips (Today / Week / All, visit type)
- Auto-clean / hide stale PREPARING notes
- Mobile swipe-to-delete
- Replace inline delete confirm with `<AlertDialog>`

### Phase 8 — Home / patient picker redesign (sprint 11)

**Goal:** From home to recording in 2 taps for known patients.

- Embedded patient search field (replaces hero CTA flow)
- Autocomplete with name + MRN matching
- ⌘K keyboard shortcut on desktop
- Compact one-line greeting
- Conditional Resume card (renders only when active/paused recording exists)
- Recent patients with labeled "Start visit →" primary button
- Single Needs Attention card (replaces 3 cards)
- Drop vanity stats; keep one deadline-oriented stat ("X notes due, Y overdue")
- Replace 🎙 emoji with Lucide Mic icon
- Remove hardcoded hex border colors

### Phase 19 — Telehealth video visits (sprints 28–31)

**Goal:** Ship single-clinician-to-single-patient video visits integrated with the existing Whisper + TitaNet pipeline.

Full spec in `telehealth-architecture-spec.md`. Phased work:

Sprint 28 — Infra + auth:
- Daily.co BAA + integration
- `TelehealthSession` table + Prisma migration
- Magic-link patient flow with DOB verification
- Patient waiting room UI (mobile-first)
- Patient video room UI (Daily SDK)
- Audit log entries

Sprint 29 — Audio integration:
- Browser-side `MediaStreamTrackProcessor` audio tap from Daily
- Stream to existing Whisper WS
- Live transcript in clinician view (reuses capture components)
- 30 s audio buffering for reconnect window
- Network quality indicator on patient tile

Sprint 30 — Capture flow integration:
- Live note generation as in-person
- Section progress + live note panel reused
- End-visit handoff to review/sign flow

Sprint 31 — Polish:
- Patient consent capture + audit
- Pre-call checks (camera / mic / network)
- Reconnection handling for both sides
- Clinician "patient is ready" notification
- TitaNet voice-ID integration on post-call review (no new code; existing pipeline)

Future (separate scope):
- Server-side recording redundancy (Option C from architecture spec)
- Patient-side captions for accessibility
- Family member / caregiver as third participant
- Screen share
- Multi-clinician consult

### Phase 18 — Marketing / signup landing redesign (sprint 27)

**Goal:** Make the public face actually convert clinicians. Lead with value, surface antihallucination, scannable pricing.

Hero:
- New headline + value-prop subhead with concrete time savings
- Two CTAs (Start free trial primary, Watch demo secondary)
- Microcopy under CTA killing the three biggest objections
- Replace 🎙 emoji with Lucide icon

Below hero:
- Live product preview (transcript + draft note split)
- Trust signal strip (HIPAA / SOC 2 / Encrypted / BAA)
- How it works (3 steps matching real product flow)
- Antihallucination spotlight section with flag-tier visual
- Pricing cards (Solo / Team recommended / Enterprise)
- Customer testimonial slot
- Final CTA section

Engineering:
- Refactor `OmniScribeAILanding` into smaller components
- Use `lib/public-pricing.ts` as pricing source of truth
- Resolve OmniScribe vs. Genscribe naming inconsistency (foundational)
- Single-column max-width 600 px layout

Future content additions:
- 90-second demo video
- Customer logo wall
- Specialty variants (/medical, /rehab, /behavioral-health)
- FAQ section
- Competitor comparison pages

### Phase 17 — Ops Console redesign (sprints 25–26)

**Goal:** Make Ops Console the company's real nervous system, not just a CRUD shell.

Foundation:
- `/api/ops/overview` aggregate endpoint with 5 s TTL cache
- `platform_cost_events` table for per-call AI cost attribution
- Reuse AdminPageShell + AdminTable from Phase 16

Overview dashboard (new):
- Live metrics row (5 tiles)
- System health panel with semantic dots
- Incidents list with severity
- Activity feed with event-type icons
- AI cost panel with sparkline + vendor breakdown
- Pulse-dot live indicator

Sidebar:
- Group 12 nav items into Workspace / Customers / Content / Compliance
- Add Incidents route (new)
- Distinct purple "Ops" mode pill

Existing pages (mostly cosmetic upgrades):
- Apply AdminPageShell to Organizations, Users, Subscriptions, Usage, Transactions, Audit logs
- Same filter chip + bulk action + overflow menu patterns
- Consolidate "admin" naming (Org Admin / Platform Owner / Ops vs. four different "Admin" labels)

New pages:
- Incidents (history + postmortem + timeline)
- Prompts (versioned CMS with A/B testing — scope separately)

### Phase 16 — Remaining tenant admin pages (sprints 23–24)

**Goal:** Apply the Admin Page Shell pattern to all five remaining admin pages.

Foundation:
- Build `<AdminPageShell>` and `<AdminTable>` reusable components
- Bulk-action transactional API per resource

Page implementations:

Sites:
- Table columns: Name + address, Members, Departments, Created, Status, Actions
- Primary CTA: + New site
- Each row links to `/admin/sites/[id]` detail page

Departments:
- Table columns: Name + parent site, Members, Lead, Specialty, Status, Actions
- Cascading site filter

Seats:
- Capacity strip with tier breakdown
- Filter chips: Status + Tier
- Replace popover-on-chip assignment with inline column
- Bulk actions: Revoke, Reassign, Extend

Voice:
- Settings page with two-column live preview (same as Documentation defaults)
- Sections: Speaker colors, Dictation defaults, Voice prints, Audio quality

Billing:
- Hybrid: subscription overview card + invoices table
- Tabs: Invoices · Usage · Payment methods · Settings
- Replace `confirm()` for destructive actions with `<AlertDialog>`

Audit (new page):
- Build `/admin/audit` for tenant org admins
- Table columns: Timestamp, Actor, Action, Target, IP, Details
- Filter chips: Action type + Date range
- CSV export
- Show-details sheet per row

### Phase 15 — Owner Console redesign (sprints 21–22)

**Goal:** Turn the multi-tenant owner view from a single-page browser into a real SaaS operations cockpit.

Routing:
- Split single `/owner` page into `/owner` (dashboard), `/owner/organizations`, `/owner/support`, `/owner/commercial`, `/owner/[orgId]`
- Build new tenant detail page with tabs (Overview · Billing · Team · Activity · Support · Audit)

Organizations list:
- Convert card grid to table with sortable columns
- Per-tenant activity sparkline (30-day note volume)
- Health status pill (composite score + reason)
- Three-tier left accent (risk / attention / healthy)
- Filter chips (Plan, Health status)
- Single "Open →" action per row

Platform metrics:
- Active orgs, MRR with trend, Trials ending, Support backlog, Seats utilization
- Replace administrative-gap metrics with SaaS metrics

Visual:
- Tokenize all status colors
- Purple-toned mode pill (distinct from admin pills)
- Match drafts/admin row treatment for consistency

Data:
- `Org.activityHistory` for sparkline (daily note counts, 30-day window)
- Health score computation (cron + event-invalidated, cached 5 min)
- Stripe-linked subscription data denormalized into `Org.commercial`
- Owner-mode action audit log surfaced on tenant detail page

### Phase 14 — Sign / signature flow redesign (sprint 20)

**Goal:** Make signing feel deliberate, secure, and ceremonious.

Sign form:
- Three signature methods (Touch ID primary, PIN, type-name fallback)
- WebAuthn registration flow during onboarding
- Inline collapsible note preview
- Attestation checkbox with org-configurable text
- Step indicator (3 of 3)
- Replace custom black-overlay modal with `<AlertDialog>` for goal verification
- Tokenize all hardcoded amber/destructive colors
- Adaptive button language ("Sign both notes with Touch ID" etc.)
- Refactor 668-line page into smaller components

Success state:
- Calmer hierarchy: single Done button + optional next-step rows
- Note ID + Locked pill (`NX-YYYY-{mrn}-{seq}` format)
- "Permanent record" framing
- Token-driven success icon styling

Future:
- Witness / co-signature workflow
- Auto-transmit to EHR (when integration exists)
- Decline / kick-back path
- Step-up auth based on session age

### Phase 13 — Auth flow redesign (sprint 19)

**Goal:** Polish the first impression and modernize the auth UX.

Login:
- Tokenized error styling (replace `text-red-600/70`)
- Sentence-case labels
- Forgot password link
- Password visibility toggle
- "Keep me signed in" checkbox (default off)
- Magic link secondary action
- Trust signal chips below card (HIPAA / SOC 2 / Encryption — config-driven)
- Spinner on loading button
- Replace "Start free testing" with "Start a free trial"
- Rate-limit lockout messaging

Signing PIN (set + verify):
- Four separate digit boxes with autofill + paste support
- Unlock-window duration stated clearly
- "Forgot your PIN? Reset it" fallback (re-set from profile)
- Same card wrapper as Login

Layout:
- All auth pages share the same card + brand-header structure
- Contextual subtitle per page

Future:
- SSO buttons (conditionally rendered per org)
- Passkey / WebAuthn support
- Account lockout self-service

### Phase 12 — Flag review panel redesign (sprint 18)

**Goal:** Polish the antihallucination feature into a defensible safety differentiator.

- Tokenize all hardcoded hex colors (RED / BLUE / YELLOW + backgrounds)
- Remove emojis from action buttons; replace with Lucide icons
- Visual dominance for RED (larger card, pulsing dot, larger count)
- Better button language ("Replace with what was actually said" etc.)
- Inline diff preview in the flag card (no separate state)
- Transcript evidence as a quote with speaker + timestamp + Jump to source link
- Section grouping in summary; section chip in active review progress
- "Report incorrect flag" feedback link
- Single "What do these mean?" tier explanation in header
- Refactor 900-line component into 5 smaller pieces
- Add `markIncorrect` resolution type + server logging for model evaluation
- Add `scrollIntoView` to transcript panel for Jump to source
- Future: batch fix for clustered REDs, org-level confidence thresholds

### Phase 11 — Admin dashboard + Team page redesign (sprints 16–17)

**Goal:** Make admin a cockpit, not a CRUD list.

Admin shell:
- Build new `/admin` overview dashboard route
- Org switcher in shell header
- Tokenize all role/status hardcoded colors
- Replace native `confirm()` with `<AlertDialog>` everywhere

Team page:
- Convert member cards to table-aligned rows
- Unify pending invites with active members (Status column distinguishes)
- Filter chips (Status + Role)
- "Last seen" activity signal
- Inline seat column (replaces popover-on-chip default)
- Bulk select with multi-action contextual bar
- Edit moves to `<Sheet>` slide-in
- Responsive: desktop full table → iPad landscape collapses Site/Dept into Member → mobile stacks as cards

Other admin pages (Sites, Departments, Seats, Voice, Documentation, Billing, Audit):
- Same row-based table pattern
- Same filter chip pattern
- Same overflow `⋯` action menu
- Reuse the StatusBadge / Label / RecordingStatus components from Phase 0

Owner Console (`/owner`):
- Tenants list instead of members list
- Metrics columns (members · seats · MRR · support flags)
- "Enter as admin →" primary action with impersonation banner

Data:
- Add `Membership.lastSeenAt` field for activity signal
- Add `/api/admin/overview/*` aggregate endpoints
- Add bulk-action transactional endpoint for memberships

### Phase 10 — Patient detail page redesign (sprints 14–15)

**Goal:** Turn the patient detail page from a launcher into a real clinical reference surface.

Both variants:
- Add snapshot strip (vitals or functional measures, by division)
- Visit history with assessment/measurement snippets per row
- Two-column desktop layout (primary content left, reference cards right)
- Mobile collapses to single column with sticky bottom CTA
- Replace inline edit form with click-to-edit pattern + sheet for full edit
- Replace custom recert/reopen modal with `<AlertDialog>`
- Tokenize all status pill colors
- Single primary CTA in the header (overflow menu for Edit etc.)

Medical-specific:
- Active conditions / problem list card
- Allergies card with severity-coded dots
- Medications card with dose / frequency
- Active goals card

Rehab-specific:
- Plan of Care primary card (ICD, discipline, frequency, duration, two progress bars)
- Functional goals with baseline → current → target progress bars
- Outcome measures card (LEFS, Tegner, NPRS, etc.)
- Referring physician visible in identity row
- Visit count chip on every visit row
- Trend deltas (Pain · ROM · Strength · LEFS) per visit instead of assessment prose

Data model:
- Add `Patient.activeConditions / allergies / medications`
- Add `Episode.functionalSnapshot / outcomeMeasures`
- Add `EpisodeGoal.progress` (baseline / current / target)
- Hybrid input: AI extraction from signed notes + inline manual override

### Phase 9 — Templates manage + editor redesign (sprints 12–13)

**Goal:** Make template governance actually possible at scale, and lift the editor from configuration form to design surface.

Manage list:
- Replace tab pattern with filter chips (Source · Division)
- Add search bar
- Section preview as inline chips
- Usage stat per row (notes / month)
- Last edited with author
- Source colored chip (Preset / CMS / Team / My / Community)
- Edit + overflow menu (replaces 4 icon-only actions)
- Bigger page heading + subtitle
- Tokenize all source/division colors

Editor:
- Replace modal with full-page editor route
- Live preview pane (~45%) with sample-transcript switcher
- AI guidance promoted out of `Advanced`
- Editable bucket labels + `+ Add bucket`
- Tabs: Structure · AI guidance · Preview · Settings
- Editable title in breadcrumb
- Real drag-to-reorder; remove chevron move buttons
- Autosave + Saved indicator
- Demote or delete vestigial section Type select
- New `/api/templates/[id]/preview` endpoint with debounced regeneration

Post-launch:
- Section snippet library (cross-template reuse)
- Diff view for preset overrides
- "Test against my last patient's transcript"

## Open questions / things to validate

These are the design recommendations I'd want product to confirm before locking the spec.

1. **The transcript-as-trust-dashboard idea (capture mobile).** If clinicians genuinely don't read the transcript during recording, the transcript tab during capture can be radically simplified. User-test the simpler version before committing.

2. **The crossover breakpoint.** I picked 900px. Confirm this against the actual device mix. If you have a lot of 1024×768 iPad portrait users, 900px is right. If most tablet users are on Pro (1366×1024) in landscape, you could push the breakpoint higher.

3. **Sign confirmation pattern.** I assumed biometric/PIN. Confirm what your auth stack supports — if Face ID/Touch ID isn't available on web, fall back to the 4-digit signing-PIN prompt (the current sign-time re-auth mechanism). Don't ship Sign without a confirmation step.

4. **AI alert false-positive tolerance.** The AI alert system is high-leverage but only if alerts are accurate. A noisy alert system trains clinicians to dismiss them, which is worse than no alert system. Recommend a 2-week silent eval (capture flagged issues without showing them to users, hand-review accuracy) before launching the surface.

5. **Prior context smart-defaults override frequency.** If clinicians override the pre-filled setup more than ~20% of the time, the defaults aren't smart enough yet. Instrument this from day 1 of phase 3.

6. **Speaker auto-assignment.** I sketched "Speaker A · likely clinician" appearing 30 seconds in. Confirm the AI model has decent confidence at that point. If not, hold off — wrong auto-assignment is worse than neutral.

## Acceptance criteria for "the redesign is done"

When all of these are true:

- A new clinician can complete their first encounter end-to-end without help: prepare → capture → review → sign.
- The product calls itself one name everywhere.
- Recording status appears in exactly one place.
- All status badges, button styles, type sizes, and spacings come from design tokens. ESLint enforces it.
- The capture page is no longer one file. No file in the project exceeds ~400 lines.
- WCAG 2.1 AA passes on all four core clinician screens (prepare, capture, review, drafts).
- Touch targets are ≥44px on every clickable element on mobile.
- Sign & finalize requires explicit confirmation.
- The AI alert system has shipped and has measured precision/recall.

## Files in this redesign

- `design-critique.md` — original full-app audit
- `design-critique-capture-flow.md` — capture flow deep dive
- `design-redesign-spec.md` — this file
- `design-mockups.html` — open in any browser to see all five mockups: prepare-mobile, capture-mobile (Stage 1 + 2), capture-desktop, review-mobile, review-desktop
