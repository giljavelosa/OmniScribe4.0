# Prior-Context Brief — UI Spec (three touchpoints)

**Status:** Draft for implementation
**Companion to:** `prior-context-brief-spec.md`, `prior-context-brief-prompt.md`
**Last updated:** 2026-05-04

---

## 1. Target experience

Three surfaces, one underlying record per follow-up item:

| Touchpoint | Surface | Primary purpose |
|---|---|---|
| **Prepare screen** | Pre-visit landing page | Read the 30-second brief; preview open follow-ups |
| **Capture screen** | During the visit | Tap-to-close follow-ups inline; brief stays glanceable |
| **Sign-time sweep** | Just before final sign | Force a decision on any still-open follow-ups |

The clinician should never feel the system is **nagging** — only that it's **holding their commitments for them**. The visual language across all three is the same: **chips, not buttons; muted defaults, color only on action; provenance always one tap away.**

## 2. Touchpoint 1 — Prepare screen brief card

### 2.1 Where it lives

File: `src/app/(clinical)/prepare/[noteId]/page.tsx`

The brief card replaces the current "Capture Workflow" placeholder block. It appears **above** the setup card (which already exists from cursor-task 03) on desktop, and **before** it on mobile (vertical stack).

**Render order on prepare:**
1. Page header (patient name, breadcrumb)
2. **Prior-context brief card** ← new
3. Setup summary card (existing — Type / Style / Template with Adjust → link)
4. Start visit CTA

### 2.2 Desktop wireframe (full state)

```
┌──────────────────────────────────────────────────────────────────────┐
│ 📋  Maria González · 68F · R shoulder, week 4 of 6                   │
│     Last seen 6 days ago · Dr. Smith · Progress Note  [open note ↗]  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ WHY SHE'S HERE                                                       │
│ R shoulder pain post fall on outstretched hand, addressing ROM       │
│ and scap stability.                                                  │
│                                                                      │
│ LAST CLINICAL IMPRESSION                                             │
│ Improving — pain trending down, AROM gains in flex/abd,              │
│ scap dyskinesis still type II.                                       │
│                                                                      │
│ TRAJECTORY                                                       ↑   │
│ Pain VAS     7   →   5   →   4                            ↘ ↘ ↘     │
│ Flex AROM   95°  →  110°  →  125°                         ↗ ↗ ↗     │
│ MMT ER      3+/5    unchanged ×2 visits                       →     │
│                                                                      │
│ ─── LAST VISIT DID ──────────────────────────────────────────────── │
│ • Manual GH joint mob grade III                                      │
│ • Scap stability prog: band rows 3×10, prone Y/T/W                   │
│ • HEP updated · Sleep posture education                              │
│                                                                      │
│ ─── PLAN SAID FOR TODAY ─────────────────────────────────────────── │
│ • Progress band rows to red                                          │
│ • Recheck scap dyskinesis                                            │
│ • Address sleep complaint if still present                           │
│                                                                      │
│ ─── OPEN FOLLOW-UPS (2) ─────────────────────────────────────────── │
│ ○ Trial NSAID — ask if started                                       │
│   from Mar 22 visit                                                  │
│ ○ Imaging report (Mar 28) — confirm reviewed                         │
│   from Mar 22 visit                                                  │
│                                                                      │
│ ▶ ACTIVE GOALS (3 of 5)                                              │
│ ▶ WATCH (2)                                                          │
│                                                                      │
│  Brief generated Apr 6 · llm-v1 · tap any line for source            │
└──────────────────────────────────────────────────────────────────────┘
```

Notes:
- Section headers are small caps, muted; they're not buttons.
- The trajectory column on the right uses single-character arrows (`↗` improving, `→` stable, `↘` worsening) at the same vertical position as the measure row. Color tokens: emerald for improving, neutral for stable, amber for worsening.
- Bottom-right meta line is the trust signal — it tells the clinician how fresh the brief is and what generated it.
- "Active goals" and "Watch" are collapsed by default (▶); tapping expands inline.

### 2.3 Mobile wireframe

```
┌──────────────────────────────────────┐
│ 📋  Maria González                   │
│     68F · R shoulder, week 4 of 6    │
│     6 days ago · Dr. Smith           │
│                  [open note ↗]       │
├──────────────────────────────────────┤
│ WHY SHE'S HERE                       │
│ R shoulder pain post fall, addressing│
│ ROM + scap stability.                │
├──────────────────────────────────────┤
│ TRAJECTORY                       ↑   │
│ Pain VAS    7→5→4              ↗     │
│ Flex AROM  95°→110°→125°       ↗     │
│ MMT ER     3+/5 unchanged      →     │
├──────────────────────────────────────┤
│ OPEN FOLLOW-UPS (2)                  │
│ ○ Trial NSAID — ask if started       │
│ ○ Imaging report — confirm reviewed  │
├──────────────────────────────────────┤
│ ▶ Last visit did                     │
│ ▶ Plan said for today                │
│ ▶ Active goals (3)                   │
│ ▶ Watch (2)                          │
├──────────────────────────────────────┤
│ Brief Apr 6 · llm-v1 · tap for source│
└──────────────────────────────────────┘
```

On mobile, more sections are collapsed by default to keep the 30-second read intact. Identity, why-she's-here, trajectory, and open follow-ups are always expanded; everything else is one tap away.

### 2.4 Component breakdown

```
prior-context/
├── BriefCard.tsx                  // top-level container; takes a PriorContextBrief
├── BriefHeader.tsx                // identity + last-visit metadata + "open note" link
├── BriefSection.tsx               // generic collapsible labeled section
├── TrajectoryTable.tsx            // measures + arrows + trend dots
├── FollowUpPreviewList.tsx        // read-only list of open follow-ups (no actions on prepare)
├── GoalsSnapshot.tsx              // top 3 active goals with delta chips
├── WatchList.tsx                  // 4 sub-arrays rendered as small chip groups
├── BriefFooter.tsx                // generation timestamp + version + provenance hint
└── EmptyBrief.tsx                 // first-encounter / brief-unavailable states
```

The existing `PriorContextPanel.tsx` continues to exist and consumes the same components — see Touchpoint 2.

### 2.5 Empty and error states

| State | Card content | Trigger |
|---|---|---|
| First-time patient | Identity strip only + microcopy: *"First visit with this patient — no prior context to surface."* | `brief === null` AND `previousNotes.length === 0` |
| Brief unavailable (generation failed) | Identity strip + amber chip: *"Brief unavailable — [open chart manually ↗]"* | `brief === null` AND `previousNotes.length > 0` |
| Stale brief (>30 days, no new note) | Full card renders; meta line shows *"Brief generated 47 days ago"* in amber | `daysSince(brief.generatedAt) > 30` |
| Loading | Skeleton layout matching the section structure | `briefQuery.isLoading` |

## 3. Touchpoint 2 — Capture screen (PriorContextPanel)

### 3.1 What changes

File: `src/app/(clinical)/capture/[noteId]/_components/PriorContextPanel.tsx` (extend, not replace).

The existing collapsed preview (last-visit one-liner) is preserved — that's the panel's resting state during a visit. When the clinician expands the panel, the **expanded body** swaps from the current "summary + goals + visits accordion" to the new structured brief content from Touchpoint 1.

The big new behavior: **open follow-ups appear with action chips inline.** This is the only place follow-ups are interactive during the visit.

### 3.2 Expanded panel wireframe (desktop, post-draft peek rail mode)

```
┌── Prior context ──────────────────────────────────────┐
│                                                       │
│ Maria González · 68F · R shoulder w4/6                │
│ 6 days ago · Dr. Smith                  [open ↗]      │
│                                                       │
│ ▼ TRAJECTORY (3 measures)                             │
│   Pain VAS    7→5→4               ↗                   │
│   Flex AROM   95°→110°→125°       ↗                   │
│   MMT ER      3+/5 ×2             →                   │
│                                                       │
│ ▼ OPEN FOLLOW-UPS (2)                                 │
│                                                       │
│   ○ Trial NSAID — ask if started                      │
│     from Mar 22                                       │
│     [ ✓ Met ]  [ ⊘ Drop ]  [ → Carry ]               │
│                                                       │
│   ○ Imaging report (Mar 28) — confirm reviewed        │
│     from Mar 22                                       │
│     [ ✓ Met ]  [ ⊘ Drop ]  [ → Carry ]               │
│                                                       │
│ ▶ Plan said for today                                 │
│ ▶ Last visit did                                      │
│ ▶ Goals (3)                                           │
│ ▶ Watch (2)                                           │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### 3.3 Chip interaction states

The three chips per follow-up have a small state machine:

```
        ┌─────────┐
        │  IDLE   │  ← chips visible, no input expanded
        └────┬────┘
             │ tap [Met]              tap [Drop]              tap [Carry]
             ▼                        ▼                        │
        ┌─────────┐             ┌──────────┐                   │
        │MET INPUT│             │DROP INPUT│                   │
        └────┬────┘             └─────┬────┘                   │
             │ Save                   │ Save                   │
             │ (closingNoteText)      │ (dropReason)           │
             ▼                        ▼                        ▼
        ┌─────────────────────────────────────────────┐
        │              SAVING (spinner)               │
        └────────────────────┬────────────────────────┘
                             │
                             ▼
        ┌─────────────────────────────────────────────┐
        │   SAVED — chip morphs to status pill        │
        │   "✓ Met · just now"  / "⊘ Dropped"  /      │
        │   "→ Carried to next visit"                 │
        └─────────────────────────────────────────────┘
```

### 3.4 Met / Drop input wireframe (inline expansion)

```
   ○ Trial NSAID — ask if started
     from Mar 22

     [ ✓ Met ]  [ ⊘ Drop ]  [ → Carry ]
            ↓ tap Met
     ┌───────────────────────────────────────────┐
     │ Closing note (required, 1–2 lines)        │
     │ ┌───────────────────────────────────────┐ │
     │ │ Started Apr 25, tolerating, no GI    │ │
     │ │ symptoms.                            │ │
     │ └───────────────────────────────────────┘ │
     │                  [ Cancel ]  [ Save ✓ ]   │
     └───────────────────────────────────────────┘
```

**Validation:**
- Met → `closingNoteText` required, min 5 chars, max 280
- Drop → `dropReason` required, min 5 chars, max 280
- Carry → no input; saves immediately on tap; shows confirmation toast

### 3.5 Anti-pattern: do not modify the review shell

The capture screen's existing review shell (the post-visit review/edit components) is protected by founder rule. **The follow-up chips live inside the prior context panel, which is already a sibling of the review shell — not inside it.** No review-shell files are modified for Touchpoint 2.

### 3.6 Mobile (capture)

Mobile capture already uses tabs (per cursor-task 02). The prior context panel becomes a swipeable bottom sheet that the clinician pulls up when they need to glance:

- Resting: bottom-pinned strip showing identity + "2 follow-ups open"
- Expanded: full-screen sheet with the same content as desktop expanded panel
- Chips have larger tap targets (44pt min) and the Met/Drop input opens as a smaller follow-up sheet from the bottom

## 4. Touchpoint 3 — Sign-time sweep

### 4.1 Where it lives

**New** sibling component to the existing review shell — explicitly NOT a modification of review-shell files (founder rule).

File: `src/app/(clinical)/review/_components/SignFollowUpSweep.tsx`

Triggered by the signing flow when the clinician taps the final "Sign" button:

1. Sign endpoint receives request
2. Server checks: are there any `FollowUp` records for this patient/episode with `status: OPEN`?
3. If yes → return `409 OPEN_FOLLOWUPS_PRESENT` with the list
4. Client intercepts → opens the sweep modal/sheet
5. After all items resolved (or explicit dismiss), client retries sign with a flag indicating sweep was acknowledged
6. Server proceeds to sign

### 4.2 Desktop modal wireframe

```
                ┌──────────────────────────────────────────────┐
                │  Before signing                          [⨯] │
                │  2 follow-ups still open                     │
                │                                              │
                │  ┌──────────────────────────────────────┐    │
                │  │ Trial NSAID — ask if started         │    │
                │  │ from Mar 22 visit · 14 days open     │    │
                │  │ [ ✓ Met ] [ ⊘ Drop ] [ → Carry ]     │    │
                │  └──────────────────────────────────────┘    │
                │                                              │
                │  ┌──────────────────────────────────────┐    │
                │  │ Imaging report (Mar 28) — confirm    │    │
                │  │ reviewed                             │    │
                │  │ from Mar 22 visit · 14 days open     │    │
                │  │ [ ✓ Met ] [ ⊘ Drop ] [ → Carry ]     │    │
                │  └──────────────────────────────────────┘    │
                │                                              │
                │  Quick:  [ Carry all ]  [ Drop all… ]        │
                │  ───────────────────────────────────────     │
                │  [ Skip — auto-carry ]   [ Continue → ]      │
                └──────────────────────────────────────────────┘
```

### 4.3 Behavior rules

- **Cannot be silently bypassed.** Tapping outside the modal does NOT close it. Only the explicit `[⨯]`, `[Skip — auto-carry]`, or `[Continue →]` buttons close it.
- **Skip path is the safety net.** If the clinician taps "Skip — auto-carry," all open items are marked `CARRIED` and rolled to the next visit's brief. An audit log entry records that the sweep was skipped (not silently swallowed).
- **Continue path is the happy path.** Activates only when every item has been Met / Dropped / Carried. The button is disabled (with a small helper "Resolve N items above") until all are addressed.
- **Quick actions are explicit.** "Carry all" needs no input. "Drop all…" opens a single shared reason field that applies to all items being dropped.
- **Optimistic UI with rollback.** Status changes apply immediately on tap; if the server rejects, the chip rolls back and shows an error toast. No work is lost.

### 4.4 Mobile (sweep)

On mobile, the sweep is a full-screen sheet — same content, vertical stack, sticky bottom action bar:

```
┌──────────────────────────────────────┐
│ Before signing               [⨯]     │
│ 2 follow-ups still open              │
├──────────────────────────────────────┤
│                                      │
│ Trial NSAID — ask if started         │
│ from Mar 22 visit · 14 days open     │
│                                      │
│ [ ✓ Met ]                            │
│ [ ⊘ Drop ]                           │
│ [ → Carry ]                          │
│                                      │
│ ─────────────────────────────────    │
│                                      │
│ Imaging report — confirm reviewed    │
│ from Mar 22 visit · 14 days open     │
│                                      │
│ [ ✓ Met ]                            │
│ [ ⊘ Drop ]                           │
│ [ → Carry ]                          │
│                                      │
├──────────────────────────────────────┤  ← sticky bar
│ [ Skip — auto-carry ]                │
│ [ Continue →           (disabled) ]  │
└──────────────────────────────────────┘
```

## 5. Microcopy

| Surface | Element | Copy |
|---|---|---|
| Brief footer | Generation meta | "Brief generated {{relativeDate}} · {{generatorVersion}} · tap any line for source" |
| Brief footer (stale) | Stale warning | "Brief generated {{relativeDate}} — older than 30 days" (amber) |
| First-visit empty | Body | "First visit with this patient — no prior context to surface." |
| Brief-unavailable empty | Body | "Brief unavailable — [open chart manually ↗]" |
| Follow-up chip | Met confirmation | "Closing note (required, 1–2 lines)" |
| Follow-up chip | Drop confirmation | "Why is this being dropped? (required)" |
| Follow-up saved | Status pill | "✓ Met · just now" / "⊘ Dropped" / "→ Carried to next visit" |
| Sign-time sweep | Title | "Before signing" |
| Sign-time sweep | Subtitle | "{{n}} follow-up{{s}} still open" |
| Sign-time sweep | Skip button | "Skip — auto-carry" |
| Sign-time sweep | Continue (disabled) | helper: "Resolve {{n}} item{{s}} above" |
| Sign-time sweep | Drop-all input | "Reason (applies to all dropped items)" |
| Toast — Met | After save | "Marked Met. Closes prior follow-up." |
| Toast — Drop | After save | "Dropped. Reason recorded." |
| Toast — Carry | After save | "Carried to next visit." |
| Toast — error | Save failed | "Couldn't save — try again. (no data lost)" |

**Tone:** factual, short, never cute. Past tense for completed actions ("Marked Met"), never present-progressive ("Marking…"). The patient's perspective is implied — the clinician is fulfilling a commitment, not completing a task.

## 6. Accessibility

- All chips are buttons with explicit `role="button"`, focus-visible outlines, 44×44pt min tap target on mobile (WCAG 2.1 AA)
- Status changes announce via `aria-live="polite"` ("Follow-up marked Met")
- Color is never the only indicator — every status carries an icon (`✓` `⊘` `→`) AND a label
- Trajectory arrows have `aria-label="improving"` / `"stable"` / `"worsening"` because screen readers can't read `↗` reliably
- Source-note tap-throughs have full accessible labels: `"Open note from Mar 22 by Dr. Smith"`
- Sign-time sweep modal traps focus, returns focus to the Sign button on close, supports escape to trigger the explicit close (still requires resolving items to actually sign)
- Reduced motion: the chip→pill morph respects `prefers-reduced-motion` and snaps without animation

## 7. Files Cursor will touch

### New
- `src/app/(clinical)/prepare/[noteId]/_components/BriefCard.tsx`
- `src/app/(clinical)/prepare/[noteId]/_components/brief/BriefHeader.tsx`
- `src/app/(clinical)/prepare/[noteId]/_components/brief/BriefSection.tsx`
- `src/app/(clinical)/prepare/[noteId]/_components/brief/TrajectoryTable.tsx`
- `src/app/(clinical)/prepare/[noteId]/_components/brief/FollowUpPreviewList.tsx`
- `src/app/(clinical)/prepare/[noteId]/_components/brief/GoalsSnapshot.tsx`
- `src/app/(clinical)/prepare/[noteId]/_components/brief/WatchList.tsx`
- `src/app/(clinical)/prepare/[noteId]/_components/brief/BriefFooter.tsx`
- `src/app/(clinical)/prepare/[noteId]/_components/brief/EmptyBrief.tsx`
- `src/app/(clinical)/capture/[noteId]/_components/FollowUpQuickAction.tsx`
- `src/app/(clinical)/review/_components/SignFollowUpSweep.tsx`
- `src/app/api/notes/[id]/follow-ups/[followUpId]/route.ts` (PATCH handler for status changes)
- `src/hooks/useFollowUpAction.ts` (optimistic update + rollback)

### Extended (additive, no behavior changes to existing UI)
- `src/app/(clinical)/prepare/[noteId]/page.tsx` — render `BriefCard` above setup card
- `src/app/(clinical)/capture/[noteId]/_components/PriorContextPanel.tsx` — swap expanded body to use new brief components; preserve collapsed preview
- `src/app/api/notes/[id]/sign/route.ts` — pre-sign open-follow-ups check; return 409 if any open

### Untouched (founder rules)
- Any review shell components — confirmed by file path inspection
- `src/services/llm/*` — no LLM calls from this UI work; brief is read from the precomputed `NoteBrief` table
- BullMQ worker code — unchanged

## 8. Acceptance criteria for the UI phases

### Phase 2 (UI: render structured brief)
- [ ] `BriefCard` renders on prepare with all sections populated when input is rich
- [ ] `BriefCard` renders gracefully (no empty boxes, no `undefined`) when fields are null
- [ ] `BriefCard` empty-state variants render correctly for first-visit, brief-unavailable, stale, loading
- [ ] `PriorContextPanel` collapsed preview unchanged from current behavior
- [ ] `PriorContextPanel` expanded body uses new components but no follow-up chips yet (those land in Phase 6)
- [ ] All source-note tap-throughs route to the correct note URL
- [ ] 3-tap test passes on mobile and desktop
- [ ] Existing screenshot/visual tests for prepare and capture still pass with snapshots updated

### Phase 6 (Follow-ups display + closing UX)
- [ ] Follow-up chips render in `PriorContextPanel` and `FollowUpPreviewList` for all open items
- [ ] Met / Drop / Carry actions persist within 1s on a healthy network
- [ ] Optimistic UI rolls back cleanly on server error
- [ ] Sign-time sweep blocks final sign when any follow-up is `OPEN`
- [ ] Sweep cannot be silently bypassed — only via explicit Skip, Continue, or close-X
- [ ] Skip auto-carries all items and writes audit log entry `FOLLOWUP_SWEEP_SKIPPED`
- [ ] Continue activates only when all items have status != OPEN
- [ ] Carried items appear automatically on next visit's prepare brief
- [ ] All status changes write to audit log `FOLLOWUP_STATUS_CHANGED`
- [ ] Keyboard navigation works through chips, modal, and inputs
- [ ] `prefers-reduced-motion` respected on chip→pill transition

## 9. Anti-patterns to avoid

- Do **not** make any chip the default focus on page load — focus belongs to the page heading or the start-visit CTA, not on a destructive-feeling chip
- Do **not** show a "Mark all met" batch action — Met requires per-item closing notes; no batch shortcut for that
- Do **not** auto-progress sign after sweep without an explicit Continue tap
- Do **not** color the entire follow-up row red on Drop — color the icon and pill only; the row stays neutral
- Do **not** move the existing collapsed preview behind a flag — Phase 2 ships additive only
- Do **not** put the follow-up close UI inside the existing review shell — it lives in a new sibling component (founder rule)
- Do **not** persist follow-up status changes via the same endpoint that signs the note — separate concern, separate endpoint, separate audit action

## 10. Open questions (deferred — not blocking)

- **Does the brief card support a "regenerate" button for clinicians?** Default: no, regen is admin-only via a one-time backfill (consistent with the master spec).
- **Does the sign-time sweep show items from earlier-than-immediately-prior visits?** Default: yes — any `OPEN` follow-up belonging to this patient/episode appears, regardless of how many visits ago it was created. The sweep is a true commitment-keeper, not just a one-back lookup.
- **Should "Carry" allow editing the follow-up text before carrying?** Default: no in v1 — preserves the original commitment verbatim. If v2 needs editing, add an inline pencil icon then.
- **Mobile sheet height — should it auto-fit to content or always full-screen?** Default: full-screen for the sweep (high-stakes), 70vh auto-fit for the inline panel.

## 11. Visual mockup (optional follow-on)

If you want a clickable HTML mockup matching `design-mockups-2026-05/` style, I can produce one as a separate deliverable. The wireframes in this spec are intentionally low-fidelity ASCII so we can lock layout and behavior before pixels.
