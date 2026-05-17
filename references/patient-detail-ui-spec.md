# Patient Detail — UI Spec (single page, five zones)

**Status:** Draft for implementation
**Companion to:** `patient-detail-spec.md`
**Last updated:** 2026-05-04

---

## 1. Target experience

Phase 13 is a single-screen redesign — the patient detail page at `src/app/(clinical)/patients/[id]/page.tsx`. Unlike the prior-context brief (three different *screens*), this is one screen with five distinct **zones**:

| Zone | Surface | Primary purpose |
|---|---|---|
| **1. Identity header** | Top of page | Inline-editable demographics, action bar, reserved telehealth slot |
| **2. Snapshot strip** | Below header | 5–6 division-keyed measure cards, override-wins precedence |
| **3. Visit history** | Center column | Date/status rows + 2-line assessment snippet per row |
| **4. Reference cards** | Right column (desktop) | Active goals · Watch · Open follow-ups |
| **5. Recert/reopen modal** | Triggered from Zone 1 action bar | `<AlertDialog>` replacing the current black-overlay |

Visual language: **muted defaults, color only on action; provenance always one tap away; clinical reference > admin tooling.** The page is the chart-orientation surface, not a launcher.

## 2. Page layout

### 2.1 Desktop (lg+ breakpoint, `≥ 1024px`)

Two-column layout, primary content left, reference cards right. `max-w-[800px]` from the current page wrapper is removed — the patient page deserves the full viewport width up to `2xl`.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ┌────────────────────────────────────────────────────────────────────────────┐  │
│ │ Maria González · 68F · MRN 78421                       [Edit] [⋯ Recert]  │  │  ← Zone 1
│ │ Rehab · R shoulder episode (active, week 4 of 6)                  [—Tele—]│  │     telehealth slot
│ └────────────────────────────────────────────────────────────────────────────┘  │     (renders null)
│                                                                                  │
│ ┌────────────────────────────────────────────────────────────────────────────┐  │
│ │ Pain    ROM flex   MMT ER    Gait      FOTO     [+ measure]                │  │  ← Zone 2
│ │ 4/10    125°       3+/5      1.1 m/s   72                                  │  │
│ │ ↓ Apr28 ↑ Apr28    = Apr28   ↑ Apr21   = Apr14                             │  │
│ └────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│ ┌──────────────────────────────────────┐  ┌────────────────────────────────────┐│
│ │ Visit history (12)                   │  │ Active goals (3 of 5)              ││  ← Zones 3 + 4
│ │                                      │  │ ↑ AROM flex 150°    on track       ││
│ │ ▸ Apr 28 — Progress · Dr. Smith      │  │ ↓ Pain ≤ 2/10       active          ││
│ │   Improving — pain trending down,    │  │ ✓ Independent HEP   met             ││
│ │   AROM gains in flex/abd, scap...    │  ├────────────────────────────────────┤│
│ │                                      │  │ Watch                              ││
│ │ ▸ Apr 21 — Progress · Dr. Smith      │  │ • Gabapentin 300mg started Apr 22  ││
│ │   Pain VAS 5, AROM flex 110°, plan   │  │ • HTN flagged uncontrolled         ││
│ │   to progress band rows next visit…  │  ├────────────────────────────────────┤│
│ │                                      │  │ Open follow-ups (2)                ││
│ │ ▸ Apr 14 — Initial Eval · Dr. Smith  │  │ □ Trial NSAID — ask if started     ││
│ │   Patient presents with 8/10 R       │  │ □ Imaging report — confirm review  ││
│ │   shoulder pain post fall…           │  └────────────────────────────────────┘│
│ │                                      │                                        │
│ │ [Load more]                          │                                        │
│ └──────────────────────────────────────┘                                        │
└──────────────────────────────────────────────────────────────────────────────────┘
```

CSS layout (Tailwind):

```tsx
<main className="mx-auto w-full max-w-[1400px] px-6 py-6">
  <PatientIdentityHeader patient={...} />              {/* Zone 1 */}
  <PatientSnapshotStrip strip={...} />                 {/* Zone 2 */}
  <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
    <VisitHistoryList rows={...} />                    {/* Zone 3 */}
    <aside className="space-y-4">
      <ActiveGoalsCard ... />                          {/* Zone 4 */}
      <WatchCard ... />
      <OpenFollowUpsCard ... />
    </aside>
  </div>
</main>
```

### 2.2 Mobile / tablet (`< lg`, `< 1024px`)

Single-column stack, in this order: Zone 1 → Zone 2 → Zone 4 (reference cards collapsed by default) → Zone 3.

Reference cards land *above* visit history on mobile because they're shorter and answer the "what's happening" question without scrolling. Visit history is the longest section and lives at the bottom.

```
┌──────────────────────────────────────┐
│ Maria González · 68F · MRN 78421     │  ← Zone 1
│ Rehab · R shoulder w4/6              │
│                  [Edit] [⋯ Recert]   │
├──────────────────────────────────────┤
│ Pain   ROM   MMT   Gait   FOTO       │  ← Zone 2 (horizontal scroll)
│ 4/10  125°  3+/5  1.1m/s  72         │     (no shrink — overflow-x-auto)
├──────────────────────────────────────┤
│ ▶ Active goals (3)                   │  ← Zone 4 (collapsed)
│ ▶ Watch (2)                          │
│ ▶ Open follow-ups (2)                │
├──────────────────────────────────────┤
│ Visit history (12)                   │  ← Zone 3
│                                      │
│ ▸ Apr 28 — Progress · Dr. Smith      │
│   Improving — pain trending down…    │
│                                      │
│ ▸ Apr 21 — Progress · Dr. Smith      │
│   Pain VAS 5, AROM flex 110°…        │
└──────────────────────────────────────┘
```

No tablet-specific layouts — `< lg` collapses straight to mobile (Phase 09 is deferred).

## 3. Zone 1 — Identity header

### 3.1 Inline-editable demographics

Click any of name / DOB / MRN / sex → that field becomes editable in place. Save on `Enter` or blur, cancel on `Escape`.

```
DEFAULT
┌────────────────────────────────────────────────────────────────────────┐
│ Maria González · 68F · MRN 78421                  [Edit] [⋯ Recert]    │
│ Rehab · R shoulder episode (active, week 4 of 6)              [—Tele—] │
└────────────────────────────────────────────────────────────────────────┘

CLICK NAME ↓
┌────────────────────────────────────────────────────────────────────────┐
│ ┌──────────────────────┐  · 68F · MRN 78421       [Edit] [⋯ Recert]    │
│ │ Maria González    ▾  │                                                │
│ └──────────────────────┘                                                │
│   Enter to save · Esc to cancel                                         │
│ Rehab · R shoulder episode (active, week 4 of 6)              [—Tele—] │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 The "Edit" button (full-edit sheet)

For changes that don't fit inline (e.g., updating address, primary contact, language preference), the `[Edit]` button opens a right-side `<Sheet>` rather than swapping the entire header for a form. This eliminates the current full-page form swallow.

### 3.3 Action bar — recert button + reserved telehealth slot

```tsx
<div className="flex items-center gap-2">
  <Button variant="ghost" onClick={openEditSheet}>Edit</Button>
  <Button variant="ghost" onClick={openRecertDialog}>⋯ Recert</Button>
  {process.env.NEXT_PUBLIC_TELEHEALTH_ENABLED === "true" && (
    <TelehealthCTA patientId={patient.id} />
  )}
</div>
```

**Critical:** `<TelehealthCTA />` itself does not exist in v1. The slot is the conditional render block — when the flag is `"true"` (which never happens in v1), the import would fail at build time. To avoid that, the slot is implemented as:

```tsx
const TelehealthCTA = (
  process.env.NEXT_PUBLIC_TELEHEALTH_ENABLED === "true"
    ? lazy(() => import("@/components/telehealth/TelehealthCTA"))
    : null
);
```

Or simpler: gate at the import site and render `null`. Sub-phase 13d picks the cleanest pattern that adds no runtime cost.

### 3.4 States

| State | Trigger | Render |
|---|---|---|
| Default | Patient loaded, no field in edit | Full identity strip, both action buttons enabled |
| Inline-edit | One field tapped/clicked | That field becomes a focused input; other fields locked; helper hint visible |
| Saving | After Enter or blur | Field shows spinner; surrounding chrome unchanged |
| Save error | Server rejects | Field rolls back to prior value; toast: "Couldn't save — try again. (no data lost)" |
| Sheet open | `[Edit]` clicked | Right sheet slides in; underlying page scrolls locked |
| Recert dialog open | `[⋯ Recert]` clicked | `<AlertDialog>` overlay (Zone 5) |

## 4. Zone 2 — Snapshot strip

The headline new component. Horizontal row of cards, max 6, division-keyed via the registry.

### 4.1 Card anatomy

```
┌──────────────────────┐
│ Pain                 │  ← label (registry.label)
│ 4/10              ↓  │  ← value · unit, trend arrow
│ Apr 28               │  ← source date
│ ◐                    │  ← source dot (extracted/manual/fhir)
└──────────────────────┘
```

Source-dot legend:

| Dot | Source | Meaning |
|---|---|---|
| `○` (open ring) | `extracted` | Pulled from a signed note via brief LLM |
| `●` (filled) | `manual` | Clinician-entered override |
| `◑` (half) | `fhir` | Pulled from EHR — Phase F1+ only, never in v1 |
| `—` | sensitivity-blocked | 42 CFR Part 2 — value hidden, "view source" gating prompt |

### 4.2 Trend arrows

Computed from the prior reading of the same `measureKey` in the same scope. Color tokens:

| Direction | Glyph | Color | Logic |
|---|---|---|---|
| improving | `↑` | emerald-600 | Numeric value moved in the registry-defined "good" direction |
| stable | `=` | neutral-500 | Within ±5% of prior |
| worsening | `↓` | amber-600 | Moved in the "bad" direction |
| no prior | (blank) | — | First reading for this measure in this scope |

The "good" direction is registry-defined per measure (e.g., pain ↓ is improving; ROM ↑ is improving). Sub-phase 13a adds `goodDirection: "up" | "down" | "neither"` to `MeasureDef` and the registry tables.

### 4.3 Card interactions

```
        ┌─────────┐
        │   IDLE  │  ← card visible, no input expanded
        └────┬────┘
             │ click card
             ▼
        ┌──────────────────────┐
        │ INLINE EDIT          │  ← input + Save / Cancel; Enter saves, Esc cancels
        │ Pain                 │
        │ ┌──────────────────┐ │
        │ │ 3                │ │
        │ └──────────────────┘ │
        │ /10  [as-of: today]  │  ← unit fixed; recordedAt defaults to now, editable
        │ [Cancel]  [Save ✓]   │
        └──────┬───────────────┘
               │ Save
               ▼
        ┌─────────┐
        │ SAVING  │  ← spinner
        └────┬────┘
             ▼
        ┌─────────────────────┐
        │ MANUAL CARD         │  ← card morphs back, source dot flips to ●
        │ Pain                │     "edited" indicator visible on hover
        │ 3/10              ↓ │
        │ today               │
        │ ●  ↺ revert         │
        └─────────────────────┘
```

`↺ revert` on a manual card → confirmation toast → soft-deletes the override → card re-renders with extracted value (or empty if no extraction).

### 4.4 Hover/tap-to-source tooltip

Hovering (or long-pressing on mobile) any card surfaces the provenance tooltip:

| Source | Tooltip |
|---|---|
| extracted | `"Extracted from Apr 28 note · Dr. Smith → open note ↗"` |
| manual | `"Edited Apr 30 by Dr. Smith. Extracted value: 4/10 (Apr 28)."` |
| fhir | `"FHIR · NextGen · pulled Apr 30 → view source"` (Phase F1+) |

### 4.5 The `[+ measure]` affordance

If the registry defines a measure that has no extraction and no override, the strip renders 5 cards plus a final `[+ measure]` button that opens the inline-edit flow on the first unfilled `MeasureDef`. Phase 13 ships this as a single button; future iterations may show all unfilled keys.

### 4.6 Empty state

If the strip is empty for a brand-new patient (no signed notes yet, no overrides), render a short empty state:

```
┌────────────────────────────────────────────────────────────────────────┐
│ No measures yet — they'll populate after the first signed visit, or   │
│ you can [+ add one] now.                                               │
└────────────────────────────────────────────────────────────────────────┘
```

## 5. Zone 3 — Visit history rows

Replaces the existing flat `<li>` list. Each row gains a 2-line `assessmentSnippet` derived from `note-text.ts`.

### 5.1 Row anatomy

```
▸ Apr 28 — Progress Note · Dr. Smith                    [SIGNED]
  Improving — pain trending down, AROM gains in flex/abd,
  scap dyskinesis still type II.
```

- Triangle (`▸`) is a tap target; expanding renders a slightly fuller preview (next 2 lines of the assessment) but does *not* navigate. Tap the row body or date to open the note.
- Status badge palette is **unchanged** — Phase 13 does not touch design tokens.
- `assessmentSnippet` is truncated to 280 chars with `…` suffix; the spec defines this in §6 of `patient-detail-spec.md`.

### 5.2 Row states

| State | Render |
|---|---|
| Signed, snippet present | Date + type + clinician + status badge, snippet underneath |
| Signed, snippet null | Date + type + clinician + status badge, italic muted text: *"No assessment captured."* |
| Draft (still in progress) | Date + type + clinician + `DRAFTING` badge, no snippet, "Resume" link |
| Sensitivity-blocked | Date + type + clinician + `RESTRICTED` badge, body replaced with: *"Restricted — request access"* |

### 5.3 Pagination

Default 10 rows visible, `[Load more]` at the bottom paginates +10 at a time. Already supported by the existing API; no API changes.

## 6. Zone 4 — Reference cards (right column)

Three cards, ordered top-to-bottom: Active goals, Watch, Open follow-ups. All three pull from existing data sources — **no new APIs in Zone 4.**

### 6.1 Active goals card

Data: top 3 `topActiveGoals` from the patient's most recent `priorContextBrief` (already populated by Phase 23).

```
┌────────────────────────────┐
│ Active goals (3 of 5)      │
│ ↑ AROM flex 150°  on track │
│ ↓ Pain ≤ 2/10     active   │
│ ✓ Independent HEP met       │
│                  [view all] │
└────────────────────────────┘
```

`[view all]` opens the existing goals timeline (no change to that surface).

### 6.2 Watch card

Data: `priorContextBrief.watch` (recent med changes + recent results + precautions + red flags).

```
┌────────────────────────────┐
│ Watch                      │
│ • Gabapentin 300mg Apr 22  │
│ • HTN flagged uncontrolled │
│   from Apr 14 visit        │
└────────────────────────────┘
```

Each item taps to its source note. If all 4 sub-arrays are empty, the card hides entirely (rather than render an empty box).

### 6.3 Open follow-ups card

Data: `FollowUp` records with `status: OPEN` for this patient.

```
┌────────────────────────────┐
│ Open follow-ups (2)        │
│ □ Trial NSAID — ask if     │
│   started                  │
│   from Mar 22 visit        │
│ □ Imaging report — confirm │
│   reviewed                 │
│   from Mar 22 visit        │
└────────────────────────────┘
```

**Read-only on the patient page.** Met / Drop / Carry chips do **not** appear here — those are visit-time interactions (per founder rule and per `prior-context-brief-ui-spec.md` §3). Tap a follow-up → opens the originating note.

## 7. Zone 5 — Recert/reopen `<AlertDialog>` migration

Replaces the current custom black-overlay pattern with a shadcn/ui `<AlertDialog>`.

```
                ┌──────────────────────────────────────────────┐
                │  Recertify episode                       [⨯] │
                │                                              │
                │  This will mark the current episode as       │
                │  recertified and reset the visit counter.    │
                │                                              │
                │  Recertification reason:                     │
                │  ┌──────────────────────────────────────┐    │
                │  │ (required, 5–280 chars)              │    │
                │  └──────────────────────────────────────┘    │
                │                                              │
                │  ─────────────────────────────────────       │
                │  [ Cancel ]                  [ Recertify → ] │
                └──────────────────────────────────────────────┘
```

Behavior rules:

- Cannot be silently bypassed. Tap-outside does *not* close (matches sign-time-sweep pattern from brief UI spec)
- Continue button disabled until reason ≥ 5 chars
- Submit calls existing recert/reopen API endpoint — **no API change**, only UI delivery changes
- Focus trap inside dialog; close returns focus to the `[⋯ Recert]` button

The "reopen" variant is the same dialog with different copy ("Reopen episode" / "Reopen reason").

## 8. Microcopy

| Surface | Element | Copy |
|---|---|---|
| Identity header (inline-edit) | Helper hint | "Enter to save · Esc to cancel" |
| Identity header (save error) | Toast | "Couldn't save — try again. (no data lost)" |
| Snapshot card (manual) | Edited indicator | "Edited {{relativeDate}} by {{userName}}" |
| Snapshot card (revert) | Confirmation | "Reverted. Showing extracted value." |
| Snapshot card (no extraction) | Empty inline | "No reading yet. [+ add]" |
| Snapshot strip (empty) | Whole-strip empty state | "No measures yet — they'll populate after the first signed visit, or you can [+ add one] now." |
| Visit history (no snippet) | Inline | "No assessment captured." (italic, muted) |
| Visit history (sensitivity) | Inline | "Restricted — request access" |
| Reference card (Watch empty) | (card hidden) | — |
| Recert dialog | Title | "Recertify episode" |
| Reopen dialog | Title | "Reopen episode" |
| Recert dialog | Reason field | "Recertification reason:" |
| Recert dialog | Submit (disabled helper) | "Reason required" |

**Tone:** factual, brief, never cute. The patient page is a clinical reference surface; copy stays out of the way.

## 9. Accessibility

- All cards (`PatientSnapshotStrip` cards, reference cards, visit history rows) are accessible buttons with `role="button"`, focus-visible outlines, 44×44pt min tap target on mobile (WCAG 2.1 AA)
- Snapshot trend arrows have `aria-label="improving"` / `"stable"` / `"worsening"` because screen readers can't read `↑` reliably
- Source-note tap-throughs have full accessible labels: `"Open note from Apr 28 by Dr. Smith"`
- Inline-edit demographics announce save/error via `aria-live="polite"`
- `<AlertDialog>` (recert/reopen) traps focus, returns focus to the trigger button on close, supports Escape to cancel
- `prefers-reduced-motion`: snapshot card morph (idle → inline-edit → manual) snaps without animation
- Color is never the only indicator — every snapshot source has both a dot AND a tooltip; every trend has both an arrow AND an aria-label
- Mobile horizontal-scroll snapshot strip: chevron hints visible until scrolled; content reachable via arrow keys when keyboard-focused

## 10. Files Cursor will touch

### New (created in 13a or 13d)

13a (foundation):
- `src/lib/types/snapshot.ts`
- `src/lib/snapshots/registry.ts`
- `src/lib/snapshots/division.ts`
- `src/app/api/patients/[id]/snapshot/override/route.ts` (POST)
- `src/app/api/patients/[id]/snapshot/override/[oid]/route.ts` (DELETE)
- `prisma/migrations/<timestamp>_add_snapshot_override/migration.sql`

13d (UI):
- `src/components/patients/PatientIdentityHeader.tsx`
- `src/components/patients/InlineEditableField.tsx` (small reusable for name/DOB/MRN/sex)
- `src/components/patients/PatientSnapshotStrip.tsx`
- `src/components/patients/SnapshotCard.tsx`
- `src/components/patients/VisitHistoryList.tsx`
- `src/components/patients/VisitHistoryRow.tsx`
- `src/components/patients/RecertReopenDialog.tsx`
- `src/components/patients/sidebar/ActiveGoalsCard.tsx`
- `src/components/patients/sidebar/WatchCard.tsx`
- `src/components/patients/sidebar/OpenFollowUpsCard.tsx`
- `src/hooks/useSnapshotOverride.ts` (optimistic create + revert with rollback)

### Extended (additive, no behavior changes to existing API/UI)

- `src/app/(clinical)/patients/[id]/page.tsx` — full re-layout to compose the new zones; existing data fetches preserved
- `src/app/api/patients/[id]/route.ts` — extend GET response with `snapshotStrip` + visit-history `assessmentSnippet` (sub-phase 13c)
- `prior-context-brief-prompt.md` + `src/lib/types/prior-context-brief.ts` — `measureKey` field added (sub-phase 13b)

### Untouched (founder rules)

- Any review or sign shell components — confirmed by file path inspection
- `src/services/llm/*` — no new LLM call paths in 13d; sub-phase 13b edits the existing brief prompt only
- BullMQ workers — unchanged
- Capture/prepare screens — Phase 13 does not modify these (per `patient-detail-spec.md` §13)

## 11. Acceptance criteria

### 13d (UI ship gate)

- [ ] Identity header renders with all four inline-editable fields working (name, DOB, MRN, sex)
- [ ] Inline-edit save persists via existing patient mutation endpoint; error path rolls back
- [ ] Snapshot strip renders 5–6 cards on a seeded rehab patient, ordered by registry priority
- [ ] Snapshot card click opens inline-edit; saving creates a `SnapshotOverride` and morphs to manual state
- [ ] Snapshot card revert soft-deletes the override and falls back to extracted (or empty)
- [ ] Trend arrows render correct direction + color for all four states
- [ ] Hover/long-press tooltip shows correct provenance for extracted vs manual cards
- [ ] Visit history rows render `assessmentSnippet` truncated to 280 chars; null snippet shows "No assessment captured."
- [ ] Active goals + Watch + Open follow-ups reference cards render from existing `priorContextBrief` data; no new API calls
- [ ] Watch card auto-hides when all four sub-arrays empty
- [ ] Recert and Reopen flows render in `<AlertDialog>`; tap-outside does not close; reason required
- [ ] `NEXT_PUBLIC_TELEHEALTH_ENABLED=false` (or unset) renders zero `<TelehealthCTA>` DOM output
- [ ] Two-column desktop layout collapses to single-column at `< lg`
- [ ] `max-w-[800px]` removed from page wrapper; full width up to `2xl`
- [ ] 3-tap test passes on desktop and mobile (open patient → tap snapshot card → land on edit input)
- [ ] All existing patient-page snapshot/visual tests updated and passing
- [ ] Type check (`npx tsc --noEmit`), unit tests (`npm test`), and build (`npm run build`) all pass

## 12. Anti-patterns to avoid

- Do **not** make any snapshot card or follow-up the default focus on page load — focus belongs to the patient name (heading) or the page itself
- Do **not** render the snapshot strip inside the capture or prepare screens (hard rule per `patient-detail-spec.md` §13)
- Do **not** add Met / Drop / Carry chips to the Open follow-ups reference card — those interactions live only in capture (per `prior-context-brief-ui-spec.md` §3)
- Do **not** color the entire snapshot card by source — only color the dot and trend arrow; the card body stays neutral
- Do **not** auto-save inline-edit demographics on every keystroke — save on Enter or blur only
- Do **not** persist a `SnapshotOverride` when value === extracted value; treat as no-op + close the input
- Do **not** put the recert/reopen logic inside the existing review shell — `RecertReopenDialog` is a sibling component
- Do **not** flip on the telehealth CTA in 13d — slot must render `null` until Phase 19 ships
- Do **not** widen `Patient` mutation API for inline-edit — re-use the existing endpoint

## 13. Open questions (deferred — not blocking)

- **Snapshot strip ordering when extraction is sparse:** if only 2 of 6 registry measures have data, do unfilled slots render as empty cards or hide entirely? Default: hide; show `[+ measure]` at the end. Re-evaluate after first month of clinician feedback.
- **Card-level edit history:** should clicking a manual card show a small history of prior overrides (audit trail surfaced)? Default: no in 13d; admin-page concern.
- **Visit history snippet language:** should the snippet be the assessment first sentence, the first 2 sentences, or the LLM-generated `priorAssessment` from the brief? Default: regex `findAssessmentContent` + truncate. Switch to `brief.priorAssessment` only if the regex baseline misses too often.
- **Mobile snapshot strip overflow:** horizontal scroll vs collapse-to-list. Default: horizontal scroll with chevron hint. Re-evaluate if usability testing shows finger-fatigue scrolling.
- **Telehealth slot visual placeholder:** when the flag is off, is the slot a 0×0 element, a small neutral pill, or nothing in the DOM? Default: nothing in the DOM (cleanest a11y, simplest CSS).

## 14. Visual mockup (optional follow-on)

The wireframes here are intentionally low-fidelity ASCII so we can lock layout and behavior before pixels. If you want a clickable HTML mockup matching `design-mockups-2026-05/` style for Zone 1 + Zone 2 (the two new visual surfaces), I can produce one as a separate deliverable after sub-phase 13c API work confirms data shapes.
